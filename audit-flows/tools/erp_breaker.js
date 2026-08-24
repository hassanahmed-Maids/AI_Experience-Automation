// ERP CIRCUIT BREAKER - canonical copy. ERP-LOAD-POLICY.md §5.
//
// Paste `erpBreakerEvaluate` plus its call site into every projection node that sees a batch
// of ERP responses. n8n has no shared-code mechanism, so "canonical" means: this file is the
// one that gets edited, and the copies are re-pasted from it. tools/erp_load_check.py can be
// pointed at a deployed workflow to find projection nodes that carry no breaker at all.
//
// WHAT IT IS FOR. Pacing (§1) bounds requests per second and the pre-flight gate (§3) bounds
// how many there are. Neither notices that ERP has ALREADY STARTED FAILING and keeps feeding
// it the remaining ten thousand calls. A run that is degrading ERP must stop, not finish the
// job: aborting loses a run, not aborting loses ERP for everyone.
//
// ------------------------------------------------------------------------------------------
// TWO THINGS §5 ASSUMED THAT TURNED OUT NOT TO BE TRUE, and the design that survives them:
//
// 1. "ABORT AT 5 CONSECUTIVE" CANNOT MEAN MID-BATCH. n8n's HTTP node takes the whole input
//    and returns when the LAST request is done; the projection Code node downstream runs once,
//    afterwards. There is no point during the batch at which our code is running, so nothing
//    of ours can stop request 6 of 1,500. The breaker therefore trips BETWEEN batches, and
//    **the batch size is the blast radius**: 750 candidates x 2 calls means up to 1,500 calls
//    land before the first possible trip. That is why the canary chunk exists (see
//    `wf-e/wfa/chunk_candidates.js`): the first chunk is deliberately small, so the first
//    verdict costs ~100 calls instead of 1,500. Trip early or trip cheap - we chose cheap.
//
//    One real mid-chunk saving does exist: `Project Plan` sits BETWEEN the two HTTP nodes, so
//    a trip there stops this chunk's second phase. That is 750 calls not made.
//
// 2. "P50 LATENCY OVER THE FIRST 20 RESPONSES" IS NOT MEASURABLE. The HTTP node reports no
//    per-response timing anywhere in its output - not in the body, not in the headers, not
//    with fullResponse. Percentiles over responses are simply not available to us. What IS
//    measurable is the batch's wall clock: stamp before the HTTP node, stamp in the
//    projection, divide by the calls made. So the latency half is a MEAN PER CALL for the
//    batch, compared against the first batch of the same run. It is a blunter instrument than
//    a p50 and it is the honest one. §5 has been corrected to say so.
//
// ------------------------------------------------------------------------------------------
// THE FAILURE THAT WOULD HAVE MADE THIS BREAKER USELESS, and is the reason for the auth class:
//
// `Fetch Replacements` returns **401 INSUFFICIENT_PERMISSIONS on every single call** for any
// account without the ClientReplacement permission - that is half of this check's enrichment
// calls, ~5,632 of them, in an unbroken run (PROBE-RESULTS #6/#13). A breaker that counted
// "five consecutive failures" would trip on call five of every run ever fired, and the fix
// somebody reaches for at that point is to raise the threshold until it stops complaining -
// at which point it no longer detects anything.
//
// So a 401/403/498 is NOT degradation. It is a permission or a dead token: the same answer
// arriving quickly, every time, which is the opposite of an overloaded server. Those have
// their own detectors downstream (`isTokenDead` in Project Plan) and their own consequence.
// Only 5xx, 429, and connection-level timeouts count here.
//
// ------------------------------------------------------------------------------------------
// THE AUTH WALL (added 2026-08-24, after ~2,400 requests that could never have succeeded).
//
// The paragraph above is still true and is NOT being softened: a 401 scattered among 200s is
// not degradation and must never be counted as one. But it was read as "auth can never stop a
// run", and that turned out to be a different and false claim.
//
// MEASURED, execution 100522 on workflow YQlNlxrnhbQpBbdl (Dummy Tickets 0-Fetch):
// GET /recruitment/maid-at-common/get-main-data/{id} under pagecode RECRUITMENT__HustlersWorkflow
// answered 401 on EVERY call. The flow fanned out over 399 applicants with maxTries 2 - ~800
// requests, three times in one day - and the breaker watched all of them go past, because auth
// is excluded from every counter it owns. A permission gap does not heal. Grinding through the
// remaining N-1 entities is pure load for exactly zero information.
//
// WHAT THIS CODE CAN ACTUALLY SEE, established from that execution's stored data rather than
// assumed. The item the projection node receives is:
//
//   { error: { message: '401 - "<html>...<div>UNAUTHORIZED &lt;LOGOUT&gt;</div></body></html>"',
//              name: 'AxiosError', code: 'ERR_BAD_REQUEST', status: 401,
//              stack: 'AxiosError: Request failed with status code 401\n    at settle ...' } }
//
// There is NO `response` key on it and therefore no `headers` - so `developerMessage`, the ONE
// header that separates ERP's three refusals, is genuinely unreachable here. That is not a
// guess: the whole item is quoted above. And the body text says `UNAUTHORIZED <LOGOUT>`, which
// per ENDPOINT-FINDING.md means any of three different things, so the text settles nothing
// either. A breaker that claimed to detect INSUFFICIENT_PERMISSIONS from this item would be
// inventing a signal that is not in it.
//
// SO THE TEST IS NOT *WHICH* REFUSAL - IT IS HOW TOTAL. All three meanings of <LOGOUT> share
// the only property that matters to a fan-out:
//   * a missing grant   - fixed for the whole run
//   * a dead session    - fixed for the whole run (nothing in these flows re-tokens mid-run)
//   * a wrong pagecode  - fixed for the whole run
// None of them can be changed by making the next call. So the rule is: THE BATCH PRODUCED NOT
// ONE SUCCESSFUL RESPONSE AND THE FAILURES ARE AUTH -> stop. That is an auth WALL, and it is
// observable with certainty from what n8n hands us.
//
// The negative case is what keeps this from crying wolf, and it is the real one: a PER-ENTITY
// denial - row-level ACL, one applicant a user may not read - arrives mixed with successes, so
// `counts.ok > 0` and nothing trips. Those entities are recorded unreachable and the run
// continues, exactly as before.
//
// AND IT DELIBERATELY DOES NOT DEPEND ON STATIC DATA. Carrying "have we ever seen an ok in this
// run" in $getWorkflowStaticData would make the rule stronger and would also make it silently
// inert on manual runs, where static data is not written - the false-clearance shape this
// project keeps finding. The batch in hand is judged on the batch in hand.
//
// ONE FLOW LEGITIMATELY OPTS OUT: WF-E's replacement phase, where a whole-batch 401 is a known
// account-scoped gap the flow already declares and the plan phase of the same chunk succeeded.
// It passes config.authWall:false at its call site, in writing. See that node.
// ------------------------------------------------------------------------------------------

const ERP_BREAKER_DEFAULTS = {
  maxConsecutive: 5,        // §5: consecutive 5xx/429 -> abort
  latencyMultiple: 3,       // §5: mean per call above 3x the run's first batch -> abort
  degradedRateFloor: 0.25,  // added: a quarter of a batch failing is not a blip
  rateMinSamples: 20,       // ...but not judged on a handful of responses
  authWall: true,           // added: a batch that was refused outright and never once succeeded
  authWallMinSamples: 5     // ...over enough calls that it is a wall and not a coincidence
};

// The one header that would separate ERP's three refusals, read as a HEADER LOOKUP and never as
// a text scan. Two reasons, both load-bearing:
//
// 1. It is usually absent. On the node shape that produced the 2,400 pointless calls
//    (fullResponse + neverError:false) a refusal arrives as an n8n error object with no headers
//    at all, so this returns '' and the breaker falls back to the wall test. Where a node is
//    configured fullResponse + neverError:true the item IS {body, headers, statusCode,
//    statusMessage} - verified on execution 93601, workflow YXRZdtk2Geeeqaal - and then this
//    can speak. It enriches the MESSAGE; it is never what decides the trip.
//
// 2. IT MUST NOT BE MATCHED IN TEXT. That same verified 200 response carries
//    `access-control-expose-headers: ... developerMessage`, on EVERY successful call. A
//    has('developermessage') scan over the item would therefore match every healthy response
//    ERP returns - the identical bug shape as the bare `503` scan that classified a contract
//    id of 503 as a server error.
function erpBreakerDeveloperMessage(item) {
  const o = item && typeof item === 'object' ? item : {};
  const h = o.headers;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return '';
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === 'developermessage') {
      const v = h[k];
      if (v === null || v === undefined) return '';
      return String(Array.isArray(v) ? v.join(',') : v).trim();
    }
  }
  return '';
}

// Classify one response item. Works on THREE different shapes, because which one arrives
// depends on how the HTTP node was configured and on how it failed:
//   - a normal parsed body (responseFormat: json)          -> ok, unless it is an error body
//   - an ERP error body (Spring shape: status/error/path)  -> classified by `status`
//   - an n8n error object (onError: continueRegularOutput) -> classified by scanning its text,
//     because n8n does not put the HTTP code anywhere predictable in it
// Scanning text is crude. It is also the only thing that works across all three, and a
// classifier that only understood the tidy shape would report a healthy run while ERP burned.
function erpBreakerClassify(item) {
  const o = item && typeof item === 'object' ? item : {};

  // An explicit numeric status wins over any text scan.
  let code = null;
  const candidates = [o.statusCode, o.status, o.httpCode, o.code,
                      o.error && o.error.httpCode, o.error && o.error.status];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 100 && n < 600) { code = n; break; }
  }

  let text = '';
  try { text = JSON.stringify(o) || ''; } catch (e) { text = String(o); }
  text = text.slice(0, 4000).toLowerCase();

  function has(s) { return text.indexOf(s) !== -1; }

  // A BARE THREE-DIGIT SCAN MUST NOT BE POINTED AT A SUCCESSFUL BODY, and for a long time it
  // was. `has('503')` matched anywhere in the item's JSON, so a healthy response classified as
  // a server error the moment its DATA happened to contain those digits - a contract id of 503,
  // an id of 1502, or an amount of 5040, which is not hypothetical: 5040 is a real price on the
  // CC price card. Stage 2 ships per-contract payloads full of ids and amounts, so five
  // consecutive ordinary contracts could trip the breaker against a perfectly healthy ERP.
  //
  // That is the crying-wolf failure this file warns about elsewhere, and the reaction to a
  // spurious trip is to raise the thresholds until it stops - at which point it detects nothing.
  //
  // So the bare digits are scanned ONLY over the error region: what n8n puts under `error`, and
  // a top-level string `message`. The distinctive PHRASES stay on the full text, because they do
  // not appear in id data and they are what catches a Spring error body nested under `body` -
  // the one shape where the status code is not reachable as a number.
  let errText = '';
  const errBits = [];
  if (o.error !== undefined && o.error !== null) errBits.push(o.error);
  if (typeof o.message === 'string') errBits.push(o.message);
  try { errText = JSON.stringify(errBits) || ''; } catch (e) { errText = String(errBits); }
  errText = errText.slice(0, 4000).toLowerCase();

  function hasErr(s) { return errText.indexOf(s) !== -1; }

  // AUTH FIRST, and deliberately so. A 401 arriving in an n8n error object often also carries
  // the word "error" and a 500-ish wrapper; classified in the other order, the permanent 401
  // on every replacement call would read as a server error and trip the breaker on every run.
  const authish = (code === 401 || code === 403 || code === 498) ||
    has('insufficient_permissions') || has('unauthorized') || has('logout') ||
    has('unauthenticated') || has('securityexception') || has('token has expired') ||
    has('jwt expired') || has('forbidden');
  if (authish) return 'auth';

  if (code === 429 || has('too many requests') || has('rate limit') || has('rate-limit')) {
    return 'throttled';
  }
  if ((code !== null && code >= 500 && code < 600) ||
      has('internal server error') || has('bad gateway') || has('service unavailable') ||
      has('gateway time-out') || has('gateway timeout') ||
      hasErr('502') || hasErr('503') || hasErr('504')) {
    return 'server_error';
  }
  // Connection-level failure. This is what an ERP that has stopped answering looks like from
  // here, and it is exactly the state the breaker exists to catch - so it counts as degraded
  // even though there is no status code to point at.
  if (has('etimedout') || has('econnreset') || has('econnrefused') || has('esockettimedout') ||
      has('socket hang up') || has('timeout of ') || has('read econnreset') ||
      has('request timed out') || has('network socket disconnected')) {
    return 'timeout';
  }
  if (code !== null && code >= 400) return 'other_failure';
  if (o.error !== undefined && o.error !== null) return 'other_failure';
  return 'ok';
}

// Pure. Decides; does not throw. The caller throws, so this stays testable.
function erpBreakerEvaluate(input) {
  const cfg = Object.assign({}, ERP_BREAKER_DEFAULTS, input.config || {});
  const responses = Array.isArray(input.responses) ? input.responses : [];
  const total = responses.length;

  const counts = { ok: 0, auth: 0, server_error: 0, throttled: 0, timeout: 0, other_failure: 0 };
  let consecutive = 0, consecutiveMax = 0, firstDegradedIndex = -1;
  let firstAuthIndex = -1, devMessage = '';
  const samples = [], authSamples = [];

  for (let i = 0; i < total; i++) {
    const cls = erpBreakerClassify(responses[i]);
    counts[cls] = (counts[cls] || 0) + 1;
    if (cls === 'auth') {
      if (firstAuthIndex === -1) firstAuthIndex = i;
      if (!devMessage) devMessage = erpBreakerDeveloperMessage(responses[i]);
      // DE-DUPLICATED, unlike the degradation samples above. A wall is by definition the same
      // refusal N times, and printing it three times pushes the part of the message that tells
      // the operator what to do off the end of what anyone reads.
      if (authSamples.length < 3) {
        let t = '';
        try { t = JSON.stringify(responses[i]) || ''; } catch (e) { t = String(responses[i]); }
        t = t.slice(0, 200);
        if (authSamples.indexOf(t) === -1) authSamples.push(t);
      }
    }
    const degraded = cls === 'server_error' || cls === 'throttled' || cls === 'timeout';
    if (degraded) {
      if (firstDegradedIndex === -1) firstDegradedIndex = i;
      consecutive++;
      if (consecutive > consecutiveMax) consecutiveMax = consecutive;
      if (samples.length < 3) {
        let t = '';
        try { t = JSON.stringify(responses[i]) || ''; } catch (e) { t = String(responses[i]); }
        samples.push(t.slice(0, 200));
      }
    } else {
      consecutive = 0;
    }
  }

  const degradedCount = counts.server_error + counts.throttled + counts.timeout;
  const degradedRate = total > 0 ? degradedCount / total : 0;

  // Mean ms per CALL, not per item: a phase that makes two calls per case must be divided by
  // the calls, or every two-call phase reads as twice as slow as it is.
  const calls = Number(input.callsMade) > 0 ? Number(input.callsMade) : total;
  const elapsed = Number(input.elapsedMs);
  const msPerCall = Number.isFinite(elapsed) && elapsed >= 0 && calls > 0 ? elapsed / calls : null;

  const baseline = Number(input.baselineMsPerCall);
  const haveBaseline = Number.isFinite(baseline) && baseline > 0;
  const latencyMultiple = haveBaseline && msPerCall !== null ? msPerCall / baseline : null;

  // An auth wall: refused outright, and NOT ONE call in this batch got through. See the header.
  // `counts.ok === 0` is the whole negative case - one success anywhere in the batch proves the
  // token, the pagecode and the endpoint all work, which makes the refusals per-entity and makes
  // continuing correct.
  // Seen vs enforced are reported separately and on purpose. A call site that opted out still
  // logs `auth_wall: true`, so the suppression is visible in the run log instead of only in the
  // code that suppressed it - the same reason `baseline_carried` is logged.
  const authWallSeen = counts.auth >= cfg.authWallMinSamples && counts.ok === 0;
  const authWallEnforced = cfg.authWall !== false;
  const authWall = authWallSeen && authWallEnforced;

  let trip = null;
  if (consecutiveMax >= cfg.maxConsecutive) {
    // Degradation is reported ahead of the wall on purpose: if ERP is BOTH refusing us and
    // falling over, "ERP is failing" is the more urgent thing to put in front of a human, and
    // the run stops either way.
    trip = { code: 'consecutive_failures', detail: consecutiveMax + ' consecutive 5xx/429/timeout responses (limit ' + cfg.maxConsecutive + ')' };
  } else if (authWall) {
    trip = { code: 'auth_wall', detail: 'ERP refused every one of ' + counts.auth + ' call(s) in this ' +
      'batch of ' + total + ' and not one succeeded' +
      (devMessage ? ' (developerMessage: ' + devMessage + ')' : '') };
  } else if (total >= cfg.rateMinSamples && degradedRate >= cfg.degradedRateFloor) {
    trip = { code: 'degraded_rate', detail: Math.round(degradedRate * 100) + '% of ' + total + ' responses were 5xx/429/timeout (limit ' + Math.round(cfg.degradedRateFloor * 100) + '%)' };
  } else if (latencyMultiple !== null && latencyMultiple > cfg.latencyMultiple) {
    trip = { code: 'latency', detail: 'this batch averaged ' + Math.round(msPerCall) + ' ms/call against a first-batch baseline of ' + Math.round(baseline) + ' ms/call, which is ' + (Math.round(latencyMultiple * 10) / 10) + 'x (limit ' + cfg.latencyMultiple + 'x)' };
  }

  return {
    phase: input.phase || 'unknown',
    total: total, counts: counts,
    degraded_count: degradedCount, degraded_rate: Math.round(degradedRate * 1000) / 1000,
    consecutive_max: consecutiveMax, first_degraded_index: firstDegradedIndex,
    ms_per_call: msPerCall === null ? null : Math.round(msPerCall),
    baseline_ms_per_call: haveBaseline ? Math.round(baseline) : null,
    latency_multiple: latencyMultiple === null ? null : Math.round(latencyMultiple * 100) / 100,
    baseline_carried: haveBaseline,
    samples: samples,
    // The auth side, reported whether or not it tripped, so a wall that was opted out of is
    // still visible in the log chain rather than only in the code that suppressed it.
    first_auth_index: firstAuthIndex,
    auth_samples: authSamples,
    auth_wall: authWallSeen,
    auth_wall_enforced: authWallEnforced,
    // '' when the header was not reachable, which is the usual case - see
    // erpBreakerDeveloperMessage. null here means "we could not see it", never "it was absent".
    developer_message: devMessage || null,
    // Declared by the CALL SITE, never read off a response: the request headers are not on the
    // item either. Carried so the message can name the grant a human has to go and ask for.
    pagecode: input.pagecode || null,
    trip: trip
  };
}

// An auth wall gets its OWN message, and this is not cosmetic. The degradation message below
// says "ERP is answering us badly, check ERP is healthy, re-run from a capped cohort" - every
// word of which is wrong advice for a permission gap, and would send the operator to look at a
// server that is working perfectly. What they need is a grant, and nothing they do to this flow
// can produce one.
function erpBreakerAuthWallMessage(v, phase, runId) {
  const where = v.pagecode ? 'pagecode ' + v.pagecode
                           : 'this node\'s pagecode (the call site did not declare which - add ' +
                             'pagecode to erpBreakerGuard so the next person is told)';
  const reason = v.developer_message
    ? 'ERP\'s developerMessage header says: ' + v.developer_message + '.'
    : 'The developerMessage response header is what separates ERP\'s three refusals, and n8n ' +
      'does not put response headers on an error item, so THIS RUN COULD NOT READ IT. The ' +
      'refusal is one of: (a) the ERP identity lacks the grant for this pagecode; (b) the ' +
      'session is dead; (c) the API is not mapped to this pagecode. Settle it by hand with one ' +
      'curl carrying the same token: a developerMessage of INSUFFICIENT_PERMISSIONS is (a), ' +
      'API_NOT_FOUND_FOR_PAGE or PAGE_CODE_MISSING is (c), and a second known-good endpoint ' +
      'refusing the same token is (b). See dummy-tickets-hm/ENDPOINT-FINDING.md.';
  return 'ERP PERMISSION WALL in ' + phase + ': ' + v.trip.detail + '. Run ' +
    String(runId || '(no run id)') + ' is stopping now, on the FIRST batch, with work ' +
    'unfinished - deliberately. | Counts this batch: ' + v.counts.ok + ' ok, ' + v.counts.auth +
    ' refused (401/403/498), ' + v.total + ' total. | Asked for: ' + where + '. | ' + reason +
    ' | ' + (v.auth_samples.length ? 'First refusals: ' + v.auth_samples.join(' || ') + ' | ' : '') +
    'WHY THIS STOPPED THE RUN RATHER THAN SKIPPING THE ENTITY: none of the three causes can ' +
    'change between call 1 and call N - the token, the pagecode and the grant are all fixed for ' +
    'the whole run - so every remaining call is load on production ERP for exactly zero ' +
    'information. On 2026-08-24 that was ~800 requests per run, three runs, all refused. ' +
    'DO NOT re-fire this run and DO NOT retry: a refusal that is total does not heal, and a ' +
    'retry doubles it. Get the grant (or a live token), then re-run. ERP-LOAD-POLICY.md §5.';
}

// The message a tripped breaker leaves behind. It is the only thing anyone will read at the
// moment the run dies, so it says what happened, what it cost, and what to do - including the
// two things NOT to do, because both are the natural reaction and both are wrong.
function erpBreakerMessage(v, phase, runId) {
  if (v.trip && v.trip.code === 'auth_wall') return erpBreakerAuthWallMessage(v, phase, runId);
  return 'ERP CIRCUIT BREAKER TRIPPED in ' + phase + ': ' + v.trip.detail + '. Run ' +
    String(runId || '(no run id)') + ' is stopping with work unfinished. | ' +
    'Counts this batch: ' + v.counts.ok + ' ok, ' + v.counts.server_error + ' server error, ' +
    v.counts.throttled + ' throttled, ' + v.counts.timeout + ' timed out, ' + v.counts.auth +
    ' auth (auth is NOT counted as degradation - see tools/erp_breaker.js). | ' +
    (v.samples.length ? 'First failures: ' + v.samples.join(' || ') + ' | ' : '') +
    'ERP is production and it is answering us badly. DO NOT re-fire this run to see if it ' +
    'passes, and DO NOT raise the thresholds - both add load to a system that is already ' +
    'failing, which is how ERP was taken down three times. Check ERP is healthy, then re-run ' +
    'from a capped cohort. ERP-LOAD-POLICY.md §5.';
}

module.exports = { ERP_BREAKER_DEFAULTS: ERP_BREAKER_DEFAULTS,
                   erpBreakerClassify: erpBreakerClassify,
                   erpBreakerDeveloperMessage: erpBreakerDeveloperMessage,
                   erpBreakerEvaluate: erpBreakerEvaluate,
                   erpBreakerAuthWallMessage: erpBreakerAuthWallMessage,
                   erpBreakerMessage: erpBreakerMessage };
