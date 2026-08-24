// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site plan --source-node "Validate Inputs"
//
// Pacing (§1) bounds requests per second. The pre-flight gate (§3) bounds how many there
// are. Neither notices that ERP has ALREADY STARTED FAILING and keeps feeding it the
// remaining ten thousand calls. This does. Aborting loses a run; not aborting loses ERP.
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
// --- the guard: reads the run's baseline, decides, logs, and throws if tripped ---------------
//
// THE BASELINE HAS TO SURVIVE BETWEEN CHUNKS, and it cannot travel in the payload: WF-A builds
// every chunk item up front and hands them to Execute Workflow in `each` mode, so there is no
// point at which WF-A can put chunk N's measurement into chunk N+1's input. n8n's per-workflow
// static data is the only carrier left. It is saved at the end of an execution and is NOT
// written for manual test runs, so the baseline can legitimately be absent - which is why an
// absent baseline disables the latency check rather than defaulting it, and why every batch
// logs `baseline_carried`. A latency check that silently never fires is the false-clearance
// shape this project keeps finding; this one announces itself in the log chain instead.
function erpBreakerStatic() {
  try { return $getWorkflowStaticData('global') || {}; } catch (e) { return null; }
}
function erpBreakerGuard(opts) {
  const src = $('Validate Inputs').first().json || {};
  const runId = String(src.run_id || '');
  const t0 = Number(src.erp_t0);
  const elapsed = Number.isFinite(t0) && t0 > 0 ? Date.now() - t0 : null;

  const sd = erpBreakerStatic();
  // A new run must not inherit the previous run's baseline: ERP at 9am and ERP at 9pm are not
  // the same server, and comparing across runs would trip on the time of day.
  if (sd && sd.erp_breaker_run !== runId) { sd.erp_breaker_run = runId; sd.erp_breaker_baseline = {}; }
  const base = (sd && sd.erp_breaker_baseline) || {};

  // opts.config is the per-call-site override. It exists for ONE declared case - a phase whose
  // whole-batch 401 is a known account-scoped gap the flow already reports - and a call site
  // that passes it must say in writing why, next to the code. It is not a threshold dial.
  const v = erpBreakerEvaluate({
    phase: opts.phase, responses: opts.responses,
    elapsedMs: elapsed, callsMade: opts.callsMade,
    baselineMsPerCall: base[opts.key],
    pagecode: opts.pagecode, config: opts.config
  });

  console.log(JSON.stringify({ stage: 'erp_breaker', phase: opts.phase, key: opts.key,
    run_id: runId || null, chunk_index: src.chunk_index === undefined ? null : src.chunk_index,
    total: v.total, counts: v.counts, degraded_rate: v.degraded_rate,
    consecutive_max: v.consecutive_max, ms_per_call: v.ms_per_call,
    baseline_ms_per_call: v.baseline_ms_per_call, baseline_carried: v.baseline_carried,
    latency_multiple: v.latency_multiple, tripped: v.trip ? v.trip.code : null,
    // Logged on EVERY batch, tripped or not. A wall that a call site opted out of has to stay
    // visible in the run log, or the opt-out becomes the thing nobody can see.
    auth_wall: v.auth_wall, auth_wall_enforced: v.auth_wall_enforced,
    first_auth_index: v.first_auth_index,
    developer_message: v.developer_message, pagecode: v.pagecode,
    static_data_available: sd !== null,
    note: 'ERP-LOAD-POLICY.md §5. A 401 among successes is NOT degradation and is not counted ' +
          'as one - the permanent 401 on every replacement call would otherwise trip this on ' +
          'call five of every run ever fired. A batch where NOTHING succeeded is a different ' +
          'thing: it is a wall, it cannot heal, and it stops the run.' }));

  if (v.trip) throw new Error(erpBreakerMessage(v, opts.phase, runId));

  // The baseline is set from the first batch BIG enough to mean anything. A canary chunk of 50
  // amortises fixed overhead over 50 calls and reads slower per call than a chunk of 750, so
  // taking the baseline from it would inflate the threshold and make the breaker LESS sensitive
  // for the rest of the run - a safety check quietly weakened by the safety measure in front
  // of it.
  if (sd && !base[opts.key] && v.ms_per_call && opts.callsMade >= (opts.minCallsForBaseline || 200)) {
    base[opts.key] = v.ms_per_call;
    sd.erp_breaker_baseline = base;
    console.log(JSON.stringify({ stage: 'erp_breaker_baseline_set', key: opts.key,
      ms_per_call: v.ms_per_call, calls: opts.callsMade, run_id: runId || null }));
  }
}
// --- call site: the overstay-fee payment fan-out ---------------------------------------------
// One search per contract, `POST /accounting/payments/...` filtered to contract.id AND
// typeOfPayment 8610. Judged in its own node because `Attach Payments` runs Once for Each Item.
//
// WHAT CAN AND CANNOT FIRE HERE:
//   consecutive_failures - LIVE, and this is the LAST per-entity ERP phase of the enrichment
//                          lane, so a trip here saves no further enrichment calls. What it does
//                          save is the evidence phase further downstream - one complaints list
//                          plus up to eight threads per red case - which is the larger half of
//                          this flow's call budget. Aborting here is still worth doing.
//   degraded_rate        - LIVE once the batch reaches 20 responses; same shrinking-subset
//                          caveat as the fines batch.
//   latency              - CANNOT FIRE. One batch per run for key `payments`, and no `erp_t0`
//                          anywhere in this flow, so elapsedMs is null and the comparison is
//                          disabled. `baseline_carried` logs false every run.
//
// `Get Overstay Payments` moved from continueErrorOutput to continueRegularOutput with this
// node, for the reason stated in `Judge Fines Batch`. The consequence is handled where it lands:
// `Attach Payments` treats a response with no `content` array as `payments_unreadable` and sends
// the case to review. That distinction is load-bearing in this check - a truncated or failed
// payment search reads as "never billed", which is exactly the false clean this flow was written
// to prevent (measured live on contract 1101801: contract.id alone returns 40 monthly-payment
// rows of 599 and zero overstay rows).
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'Overstay-fee payments (MV Overstay Fines)',
  key: 'payments',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
// =================== END ERP CIRCUIT BREAKER ===================

// Pass the batch on untouched, with the item-linking chain PINNED.
//
// `return $input.all()` on its own is what the sibling flows do, and it is not enough here.
// The node this feeds runs Once for Each Item and reaches back with `$('...').item`, so it
// needs an unbroken pairedItem chain through this node. `Merge with previous_cases` already
// carries the scar and says so in its own comments: n8n does NOT auto-assign pairedItem for a
// node running Once for All Items, and the first live run to get past intake died on exactly
// that - "Paired item data for item from node ... is unavailable". Inserting one more
// Once-for-All node into that chain without pinning would reproduce it.
//
// Output item i came from input item i: this node reorders nothing, drops nothing and adds
// nothing. The items themselves are returned rather than rebuilt as { json: ... }, which would
// discard binary data and any pairing already on them.
const _out = $input.all();
for (let i = 0; i < _out.length; i++) _out[i].pairedItem = { item: i };
return _out;
