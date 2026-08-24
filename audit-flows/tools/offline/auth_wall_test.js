/**
 * auth_wall_test.js - the breaker must stop a run that ERP is refusing outright, and must NOT
 * stop one that ERP is merely refusing in places.
 *
 * WHY THIS FILE EXISTS. On 2026-08-24 Dummy Tickets fanned out over 399 unique applicants
 * against GET /recruitment/maid-at-common/get-main-data/{id}, pagecode
 * RECRUITMENT__HustlersWorkflow, with retryOnFail/maxTries 2. Every single call returned 401.
 * Three runs = ~2,400 requests to production ERP that could never have succeeded, and the
 * breaker watched all of them go past, because §5 excluded auth from every counter it owns.
 *
 * THE FIXTURES ARE NOT INVENTED. `REAL_100522` is the error item copied verbatim out of
 * execution 100522 on workflow YQlNlxrnhbQpBbdl (node "Get Hustler Tickets"), and
 * `REAL_200_HEADERS` is the header block copied out of execution 93601 on workflow
 * YXRZdtk2Geeeqaal (node "Get Flight Tickets") - the same ERP endpoint, configured
 * fullResponse + neverError:true, answering 200. Between them they settle what the breaker can
 * and cannot see, which is the whole basis of the rule under test.
 *
 *   node tools/offline/auth_wall_test.js
 */
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
function rep(item, n) { const a = []; for (let i = 0; i < n; i++) a.push(item); return a; }

// ---------------------------------------------------------------- fixtures, all real
// Execution 100522, "Get Hustler Tickets", output item 0. Verbatim, including the fact that
// there is NO `response` key and therefore no headers on it.
const REAL_100522 = { error: {
  message: '401 - "<html><body><h1>Whitelabel Error Page</h1><p>This application has no explicit '
         + "mapping for /error, so you are seeing this as a fallback.</p><div id='created'>Mon Aug "
         + '24 11:58:02 GST 2026</div><div>There was an unexpected error (type=Unauthorized, '
         + 'status=401).</div><div>UNAUTHORIZED &lt;LOGOUT&gt;</div></body></html>"',
  name: 'AxiosError',
  stack: 'AxiosError: Request failed with status code 401\n    at settle (/usr/local/lib/node_modules/n8n/...)',
  code: 'ERR_BAD_REQUEST', status: 401 } };

// Execution 93601, "Get Flight Tickets" - the SAME ERP endpoint and pagecode, on a node
// configured fullResponse + neverError:true, answering 200. Header block verbatim.
const REAL_200_HEADERS = {
  date: 'Wed, 19 Aug 2026 11:48:33 GMT',
  'content-type': 'application/json',
  'access-control-expose-headers':
    'Content-disposition, technical, token, captchaId, captchaAttachmentUuid, SPEED_TEST_REQUIRED, developerMessage',
  'x-request-id': '77b07c05-850c-41df-89c4-a585fd9bbbed',
  'cache-control': 'no-cache, no-store, max-age=0, must-revalidate',
  'x-frame-options': 'DENY' };
const REAL_200 = { statusCode: 200, statusMessage: 'OK', headers: REAL_200_HEADERS,
  body: { flightsTickets: { requestFlightTicketActions: [{ id: 91, ticketType: 'ARRIVAL' }] } } };

// The permanent ClientReplacement denial (PROBE-RESULTS #6/#13) - the shape §5 was written
// around, and the one that must not change behaviour when it is MIXED with successes.
const AUTH_401 = { error: { message: '401 - "{"timestamp":"2026-08-19T10:04:12.001+00:00","status":401,'
  + '"error":"Unauthorized","message":"INSUFFICIENT_PERMISSIONS","path":"/replacement/page/contract/1054346"}"',
  name: 'NodeApiError', httpCode: '401' } };

const OK_PLAN = { paymentPlan: { additionalDiscount: null }, currentPayment: { amountValue: 4715 } };
const ERR_503 = { error: { message: 'The service was temporarily unavailable - 503 Service Unavailable',
  name: 'NodeApiError' } };
const ERR_TIMEOUT = { error: { message: 'connect ETIMEDOUT 10.0.0.4:443', name: 'NodeApiError' } };

// ================================================================================
head('what the breaker can actually SEE on the item that caused this');
// Everything below rests on these three facts about the REAL error item, so they are asserted
// rather than assumed. If a future n8n version changes any of them, this is where it shows up.
eq('the real refusal still classifies as auth, not degradation',
   B.erpBreakerClassify(REAL_100522), 'auth');
eq('there are NO response headers on it, so developerMessage is unreachable',
   B.erpBreakerDeveloperMessage(REAL_100522), '');
ok('and its text says UNAUTHORIZED <LOGOUT>, which per ENDPOINT-FINDING.md means three things',
   /UNAUTHORIZED &lt;LOGOUT&gt;/.test(REAL_100522.error.message));
ok('...while the string INSUFFICIENT_PERMISSIONS is NOT in the item at all - it was only ever '
   + 'in the header, which is why the trip cannot be built on it',
   JSON.stringify(REAL_100522).indexOf('INSUFFICIENT_PERMISSIONS') === -1);

// ================================================================================
head('THE CASE THAT COST ~2,400 REQUESTS: a chunk of 25 refusals, nothing succeeded');
const wall = B.erpBreakerEvaluate({ phase: 'Project Tickets', responses: rep(REAL_100522, 25),
  pagecode: 'RECRUITMENT__HustlersWorkflow' });
ok('it trips', wall.trip !== null, JSON.stringify(wall.trip));
eq('...with its own code, not a degradation code', wall.trip && wall.trip.code, 'auth_wall');
eq('...and none of it is counted as degradation', wall.degraded_count, 0);
eq('...the consecutive-degradation counter is still zero', wall.consecutive_max, 0);
eq('...they are counted as auth, so the run can still see them', wall.counts.auth, 25);
eq('...and it names where the first one was', wall.first_auth_index, 0);
eq('the wall is reported as seen', wall.auth_wall, true);
eq('...and as enforced', wall.auth_wall_enforced, true);

// The blast radius. n8n's HTTP node returns only when its LAST request is done, so nothing of
// ours can stop call 6 of 25 - the earliest possible trip is after the first batch. This is the
// honest version of "trip on the FIRST refusal": first BATCH, and the batch size is the cost.
eq('the whole first chunk is what it costs - 25 calls, not 399', wall.total, 25);

head('the message tells the operator the right thing, which is a different thing');
const msg = B.erpBreakerMessage(wall, 'Project Tickets (Dummy Tickets HM 0-Fetch)', 'run-100522');
ok('it names the pagecode the call site declared',
   msg.indexOf('RECRUITMENT__HustlersWorkflow') !== -1, msg);
ok('it says plainly that developerMessage could NOT be read, rather than guessing the reason',
   /COULD NOT READ IT/.test(msg), msg);
ok('...and lists all three meanings of the refusal', /\(a\)/.test(msg) && /\(b\)/.test(msg) && /\(c\)/.test(msg));
ok('...and gives the one experiment that settles it', msg.indexOf('curl') !== -1);
ok('it does NOT tell them to go and check whether ERP is healthy - ERP is fine, they lack a grant',
   msg.indexOf('Check ERP is healthy') === -1, msg);
ok('it forbids the retry, which is what doubled the load', msg.indexOf('DO NOT retry') !== -1);
ok('it forbids re-firing', msg.indexOf('DO NOT re-fire') !== -1);
ok('it names the run', msg.indexOf('run-100522') !== -1);
ok('it points at the policy', msg.indexOf('ERP-LOAD-POLICY.md') !== -1);
ok('the identical refusal is printed ONCE, not three times',
   (msg.match(/Whitelabel Error Page/g) || []).length === 1, msg);

// A call site that forgot to declare its pagecode must say so, not print "undefined".
const noPc = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REAL_100522, 25) });
const noPcMsg = B.erpBreakerMessage(noPc, 'p', 'r');
ok('an undeclared pagecode is reported as undeclared, with the fix',
   /did not declare which/.test(noPcMsg) && noPcMsg.indexOf('undefined') === -1, noPcMsg);

// ================================================================================
head('THE NEGATIVE CASES - each one is a way this could have started crying wolf');

// 1. THE ONE THE TASK ASKED FOR. A transient 503 is degradation, and degradation has its own
//    rules with their own thresholds. It must not reach the permission path at all.
const transient503 = B.erpBreakerEvaluate({ phase: 'p', responses: rep(ERR_503, 4) });
eq('4 transient 503s do not trip anything', transient503.trip, null);
eq('...and are NOT read as an auth wall', transient503.auth_wall, false);
eq('...they are counted as server errors', transient503.counts.server_error, 4);
eq('...with zero auth', transient503.counts.auth, 0);

const wholeBatch503 = B.erpBreakerEvaluate({ phase: 'p', responses: rep(ERR_503, 25) });
eq('an ENTIRE batch of 503s - zero ok, same as the wall - still trips on DEGRADATION',
   wholeBatch503.trip && wholeBatch503.trip.code, 'consecutive_failures');
eq('...and is not reported as an auth wall, because none of it was auth',
   wholeBatch503.auth_wall, false);
ok('...so its message is the ERP-is-failing one, telling them to check ERP is healthy',
   B.erpBreakerMessage(wholeBatch503, 'p', 'r').indexOf('Check ERP is healthy') !== -1);

const wholeBatchTimeout = B.erpBreakerEvaluate({ phase: 'p', responses: rep(ERR_TIMEOUT, 25) });
eq('a batch of connection timeouts is degradation too, never a permission wall',
   wholeBatchTimeout.trip && wholeBatchTimeout.trip.code, 'consecutive_failures');
eq('...auth wall false', wholeBatchTimeout.auth_wall, false);

// 2. THE RUN-KILLER §5 WAS WRITTEN AROUND. 5,632 replacement denials arriving ALONGSIDE
//    successes are a per-entity gap, and continuing is correct.
const mixed = [];
for (let i = 0; i < 200; i++) mixed.push(i % 2 === 0 ? AUTH_401 : OK_PLAN);
const mixedV = B.erpBreakerEvaluate({ phase: 'replacements', responses: mixed });
eq('100 denials mixed with 100 successes do NOT trip', mixedV.trip, null);
eq('...because a single success proves the token, pagecode and endpoint all work',
   mixedV.auth_wall, false);
eq('...the denials are still counted', mixedV.counts.auth, 100);

const oneSuccess = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REAL_100522, 749).concat([OK_PLAN]) });
eq('ONE success anywhere in a batch of 750 is enough to keep going - the wall test is total, '
   + 'not a rate', oneSuccess.trip, null);
eq('...and the wall is reported as not seen', oneSuccess.auth_wall, false);

// 3. TOO FEW TO BE A WALL. A paged sweep of 3 pages, or a batch of one, reaches no threshold -
//    the same honesty the `pages` call site already writes down about the rate and latency rules.
const four = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REAL_100522, 4) });
eq('4 refusals are below the minimum and do not trip', four.trip, null);
eq('...but the auth count is still reported, so it is not invisible', four.counts.auth, 4);
const five = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REAL_100522, 5) });
eq('5 is the threshold and does trip', five.trip && five.trip.code, 'auth_wall');

// 4. AN EMPTY BATCH IS NOT A WALL.
eq('an empty batch does not trip', B.erpBreakerEvaluate({ phase: 'p', responses: [] }).trip, null);
eq('...and is not a wall', B.erpBreakerEvaluate({ phase: 'p', responses: [] }).auth_wall, false);

// 5. HEALTHY TRAFFIC IS NOT A WALL, however much of it there is.
const healthy = B.erpBreakerEvaluate({ phase: 'p', responses: rep(OK_PLAN, 750) });
eq('750 good responses do not trip', healthy.trip, null);
eq('...and report no auth at all', healthy.counts.auth, 0);
eq('...and no first auth index', healthy.first_auth_index, -1);

// ================================================================================
head('the developerMessage header: used when present, NEVER matched as text');
// THIS IS THE 5040 BUG WAITING TO HAPPEN. Every successful ERP response carries
// `access-control-expose-headers: ... developerMessage` - verified above, execution 93601. A
// has('developermessage') scan over the item would match EVERY healthy response.
ok('a real 200 response literally contains the string developerMessage in its headers',
   JSON.stringify(REAL_200).indexOf('developerMessage') !== -1);
eq('...and is still classified ok', B.erpBreakerClassify(REAL_200), 'ok');
eq('...and yields NO developerMessage, because the lookup is by header NAME not by text',
   B.erpBreakerDeveloperMessage(REAL_200), '');
const healthyFull = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REAL_200, 25) });
eq('...so a batch of 25 real 200s does not trip', healthyFull.trip, null);
eq('...and reports no developer message', healthyFull.developer_message, null);

// When a node IS configured neverError:true, a refusal arrives as a full response and the
// header becomes reachable. Then the breaker stops hedging and names the reason.
const REFUSED_FULL = { statusCode: 401, statusMessage: 'Unauthorized',
  headers: Object.assign({}, REAL_200_HEADERS, { developerMessage: 'INSUFFICIENT_PERMISSIONS' }),
  body: 'UNAUTHORIZED <LOGOUT>' };
eq('a full-response 401 is still auth', B.erpBreakerClassify(REFUSED_FULL), 'auth');
eq('the header is read case-insensitively',
   B.erpBreakerDeveloperMessage({ headers: { DeveloperMessage: 'INSUFFICIENT_PERMISSIONS' } }),
   'INSUFFICIENT_PERMISSIONS');
const named = B.erpBreakerEvaluate({ phase: 'p', responses: rep(REFUSED_FULL, 25),
  pagecode: 'RECRUITMENT__HustlersWorkflow' });
eq('a wall of those trips', named.trip && named.trip.code, 'auth_wall');
eq('...and reports the header', named.developer_message, 'INSUFFICIENT_PERMISSIONS');
const namedMsg = B.erpBreakerMessage(named, 'p', 'r');
ok('...so the message states the reason instead of listing three possibilities',
   /developerMessage header says: INSUFFICIENT_PERMISSIONS/.test(namedMsg) &&
   !/COULD NOT READ IT/.test(namedMsg), namedMsg);
ok('the trip detail carries it too, for the log line', /INSUFFICIENT_PERMISSIONS/.test(named.trip.detail));

// A HEADER THAT IS NOT AN OBJECT MUST NOT THROW - a throw in a projection node strands a lease.
let threw = false;
for (const weird of [null, undefined, 0, 'x', { headers: null }, { headers: 'x' }, { headers: [] },
                     { headers: { developermessage: null } }, { headers: { developermessage: 7 } }]) {
  try { B.erpBreakerDeveloperMessage(weird); } catch (e) { threw = true; console.log('       threw on ' + JSON.stringify(weird)); }
}
ok('the header reader never throws, whatever it is handed', !threw);

// ================================================================================
head('precedence: an ERP that is BOTH refusing us and falling over');
// Degradation is reported first. The run stops either way, but "ERP is failing" is the more
// urgent thing to put in front of a human than "you need a grant".
const both = B.erpBreakerEvaluate({ phase: 'p',
  responses: rep(REAL_100522, 20).concat(rep(ERR_503, 5)) });
eq('zero successes, 20 refusals AND 5 consecutive 503s -> reported as degradation',
   both.trip && both.trip.code, 'consecutive_failures');
eq('...but the wall is still recorded, so the second cause is not lost', both.auth_wall, true);

// ================================================================================
head('the declared opt-out - WF-E replacements, where continuing is currently right');
// A whole-batch 401 that a flow ALREADY declares and reports, on an optional enrichment whose
// sibling phase in the same chunk succeeded. Aborting there would throw away the plan
// enrichment that worked. The opt-out is per call site and has to be written down next to it.
const optedOut = B.erpBreakerEvaluate({ phase: 'Project Replacements (WF-E)',
  responses: rep(AUTH_401, 750), config: { authWall: false } });
eq('a declared opt-out does not trip', optedOut.trip, null);
eq('...but the wall is STILL reported as seen, so the suppression is visible in the run log',
   optedOut.auth_wall, true);
eq('...flagged as not enforced', optedOut.auth_wall_enforced, false);
eq('...and the denials are still counted', optedOut.counts.auth, 750);
// The opt-out is for the permission path ONLY. It must not become a way to silence the breaker.
const optedOutButSick = B.erpBreakerEvaluate({ phase: 'p',
  responses: rep(AUTH_401, 20).concat(rep(ERR_503, 5)), config: { authWall: false } });
eq('opting out of the wall does NOT opt out of degradation',
   optedOutButSick.trip && optedOutButSick.trip.code, 'consecutive_failures');

// ================================================================================
head('everything §5 already guaranteed is unchanged');
const allAuthMixedRun = B.erpBreakerEvaluate({ phase: 'p',
  responses: rep(AUTH_401, 5632).concat([OK_PLAN]), elapsedMs: 5633 * 250, callsMade: 5633 });
eq('the 5,632-denial replacement phase, with one success, still does not trip',
   allAuthMixedRun.trip, null);
eq('...still zero degraded', allAuthMixedRun.degraded_count, 0);
eq('...still zero consecutive degradation', allAuthMixedRun.consecutive_max, 0);
const latency = B.erpBreakerEvaluate({ phase: 'p', responses: rep(OK_PLAN, 750),
  elapsedMs: 1500 * 800, callsMade: 1500, baselineMsPerCall: 250 });
eq('the latency rule still fires on healthy-but-slow traffic', latency.trip.code, 'latency');
eq('...and that batch is not a wall', latency.auth_wall, false);

// ================================================================================
head('the EMBEDDED copy, in the node body that made the ~2,400 calls');
// Everything above proves the canonical logic. This runs the actual deployed node body -
// dummy-tickets-hm/nodes/stage0_project_tickets.js, breaker block and all - against a chunk of
// the real 100522 items, because a canonical fix that never reached the paste is the failure
// mode this whole generate-and-byte-compare arrangement exists to prevent.
{
  const fs = require('fs'), path = require('path');
  const BODY = fs.readFileSync(path.join(__dirname, '..', '..', 'dummy-tickets-hm', 'nodes',
    'stage0_project_tickets.js'), 'utf8');

  function runNode(responses) {
    const applicants = responses.map(function (_, i) {
      return { json: { applicant_id: 1000 + i, run_id: 'e2e-dtm', erp_t0: Date.now() - 12000,
                       chunk_index: 0 } }; });
    const nodes = { 'Expand Applicants': applicants };
    const $ = function (name) {
      const items = nodes[name] || [];
      return { all: function () { return items; }, first: function () { return items[0]; } };
    };
    const $input = { all: function () { return responses.map(function (r) { return { json: r }; }); } };
    const logs = [];
    const fn = new Function('$', '$input', '$getWorkflowStaticData', 'console',
      'return (function(){' + BODY + '})();');
    const out = fn($, $input,
      function () { throw new Error('no static data on a manual run'); },
      { log: function (s) { try { logs.push(JSON.parse(s)); } catch (e) { logs.push({ raw: s }); } } });
    return { out: out, logs: logs };
  }

  let thrown = '';
  let logs = [];
  try { runNode(rep(REAL_100522, 25)); }
  catch (e) { thrown = e.message; }
  ok('the deployed node body THROWS on 25 real refusals - it no longer projects 25 ' +
     '"reachable:false" rows and lets the parent fetch the next chunk', thrown !== '', thrown);
  ok('...as a permission wall', /ERP PERMISSION WALL/.test(thrown), thrown.slice(0, 200));
  ok('...naming the pagecode its own HTTP node sends',
     thrown.indexOf('RECRUITMENT__HustlersWorkflow') !== -1, thrown.slice(0, 200));
  ok('...and naming the phase, so the operator knows which of the two ERP reads refused',
     thrown.indexOf('Project Tickets (Dummy Tickets HM 0-Fetch)') !== -1, thrown.slice(0, 200));

  // AND IT STILL WORKS. The projection must be untouched for a healthy chunk - a breaker that
  // fixes the refusal case by breaking the normal case is not a fix.
  const goodBody = { statusCode: 200, headers: REAL_200_HEADERS, body: { flightsTickets:
    { requestFlightTicketActions: [{ id: 7, ticketType: 'ARRIVAL', status: 'DONE',
                                     amountInAED: 1200, requestRefundOn: 'ARRIVAL' }] } } };
  const good = runNode(rep(goodBody, 25));
  eq('25 healthy responses project 25 rows', good.out.length, 25);
  eq('...all reachable', good.out.filter(function (o) { return o.json.reachable; }).length, 25);
  eq('...with their tickets parsed off the exact path', good.out[0].json.path_used, 'exact');
  const bl = good.logs.filter(function (l) { return l.stage === 'erp_breaker'; })[0];
  ok('...and the breaker logged a clean verdict over the batch',
     bl && bl.tripped === null && bl.counts.ok === 25, JSON.stringify(bl && bl.counts));
  eq('...with the wall reported as not seen', bl && bl.auth_wall, false);
  eq('...and the pagecode carried into the log line', bl && bl.pagecode, 'RECRUITMENT__HustlersWorkflow');

  // A SINGLE unreadable applicant among 24 good ones is a per-entity gap, not a wall: the row is
  // marked unreachable and the run goes on, which is exactly the old behaviour.
  const one = runNode(rep(goodBody, 24).concat([REAL_100522]));
  eq('one refusal among 24 successes still projects 25 rows', one.out.length, 25);
  eq('...with that one marked unreachable',
     one.out.filter(function (o) { return o.json.reachable === false; }).length, 1);
  const bl2 = one.logs.filter(function (l) { return l.stage === 'erp_breaker'; })[0];
  eq('...and nothing tripped', bl2 && bl2.tripped, null);
}

console.log('\n' + (fail === 0 ? 'all ' + pass + ' passed' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
