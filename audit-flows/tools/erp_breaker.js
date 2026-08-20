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
// ------------------------------------------------------------------------------------------

const ERP_BREAKER_DEFAULTS = {
  maxConsecutive: 5,        // §5: consecutive 5xx/429 -> abort
  latencyMultiple: 3,       // §5: mean per call above 3x the run's first batch -> abort
  degradedRateFloor: 0.25,  // added: a quarter of a batch failing is not a blip
  rateMinSamples: 20        // ...but not judged on a handful of responses
};

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
      has('gateway time-out') || has('gateway timeout') || has('502') || has('503') || has('504')) {
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
  const samples = [];

  for (let i = 0; i < total; i++) {
    const cls = erpBreakerClassify(responses[i]);
    counts[cls] = (counts[cls] || 0) + 1;
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

  let trip = null;
  if (consecutiveMax >= cfg.maxConsecutive) {
    trip = { code: 'consecutive_failures', detail: consecutiveMax + ' consecutive 5xx/429/timeout responses (limit ' + cfg.maxConsecutive + ')' };
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
    trip: trip
  };
}

// The message a tripped breaker leaves behind. It is the only thing anyone will read at the
// moment the run dies, so it says what happened, what it cost, and what to do - including the
// two things NOT to do, because both are the natural reaction and both are wrong.
function erpBreakerMessage(v, phase, runId) {
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
                   erpBreakerEvaluate: erpBreakerEvaluate,
                   erpBreakerMessage: erpBreakerMessage };
