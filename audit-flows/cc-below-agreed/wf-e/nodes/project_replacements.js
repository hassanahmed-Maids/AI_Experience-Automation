// Project Replacements + Return (WF-E) - the COVERAGE side, then collapse the whole chunk
// to ONE item and let this execution die with the raw bodies.
//
// LIFTED FROM WF-A's Attach Replacements, minus the assembly. That node was also the
// point where the two enrichment deltas were joined back onto the full case; here the join
// happens in WF-A's Join Enrichment, because the full cases must not cross this boundary
// twice. What crosses is the DELTA per candidate - plan + replacements - which is what the
// scorer actually reads.
//
// NO RECORDS FOR A CONTRACT IS NOT "no maid was ever placed". It far more often means the
// contract simply never had a change - the original maid is still there and coverage starts
// at the contract's own tag date. So this records an absence of RECORDS, and gate 7 decides
// what that means.
//
// GATE 7 also carries the same-day rule: on 1054346 the outgoing maid left 12:28 and the
// incoming arrived 13:35 the SAME DAY (26 Jun), so July was fully covered even though the
// contract's tag date reads 2026-08-03. A same-day swap is not a coverage gap, and the tag
// date does not answer the coverage question at all.
const planDeltas = $('Project Plan').all().map(function (i) { return i.json; });
const responses = $input.all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

if (responses.length !== planDeltas.length) {
  throw new Error('Project Replacements: ' + responses.length + ' replacement responses for ' +
    planDeltas.length + ' candidates. Positional pairing is broken, so a case would be given ' +
    'another contract\'s maid history - refusing to guess which.');
}

// ---------------------------------------------------------------------------------------
// CLASSIFYING A FAILED CALL, because the previous version of this could not.
//
// THE BUG THIS REPLACES: the old detector tested String(resp.status) === '401' and searched
// String(resp.error) for 'unauthor'. n8n's continueRegularOutput does NOT hand back the HTTP
// body on a failure - it hands back an ERROR OBJECT - so resp.status was undefined and
// String(resp.error) rendered '[object Object]'. The counter therefore read 0 while all 750
// replacement calls were failing, and a counter that reports zero for both "the grant landed"
// and "every call is denied" is worse than no counter at all: it was the number I would have
// used to say the permission had been granted.
//
// THREE OUTCOMES, NOT ONE, and separating them is the point:
//   permission_denied  401/403 + INSUFFICIENT_PERMISSIONS. The KNOWN steady state of
//                      /complaints/replacement on this account (probes #6 and #13). Coverage
//                      is read from what remains; gate 7 decides what an absence means.
//   token_dead         UNAUTHORIZED <LOGOUT> / UNAUTHENTICATED, or the 498-inside-500 shape.
//                      A DIFFERENT ANIMAL ENTIRELY: the token died mid-run, so every read
//                      after it is empty, and empty reads score as "no maid change" and
//                      "no discount" - which clears cases that should not clear. This one
//                      throws.
//   other              anything else. Counted, never interpreted.
function httpCodeOf(o) {
  const e = o.error && typeof o.error === 'object' ? o.error : {};
  const ctx = e.context && typeof e.context === 'object' ? e.context : {};
  const cands = [o.status, o.statusCode, o.httpCode, o.code,
                 e.httpCode, e.status, e.statusCode, e.code, ctx.httpCode];
  for (let i = 0; i < cands.length; i++) {
    const n = Number(cands[i]);
    if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
  }
  return null;
}
// JSON.stringify, not String(): the marker lives in a nested message/description and String()
// flattens the whole object to '[object Object]', which is exactly how this went wrong before.
// Bounded, because an n8n error carries a stack.
function failureText(o) {
  let t = '';
  try { t = JSON.stringify(o) || ''; } catch (err) { t = String(o); }
  return t.slice(0, 4000).toLowerCase();
}
function isTokenDead(text) {
  return text.indexOf('logout') !== -1 || text.indexOf('unauthenticated') !== -1 ||
         text.indexOf('498') !== -1 || text.indexOf('token has expired') !== -1 ||
         text.indexOf('jwt expired') !== -1;
}
function isPermissionDenied(code, text) {
  if (text.indexOf('insufficient_permissions') !== -1) return true;
  if (text.indexOf('securityexception') !== -1 || text.indexOf('access denied') !== -1) return true;
  // A bare 401/403 with no ERP marker at all: treat as a denial rather than a dead token,
  // because that is the measured shape of this route, but it is counted as UNMARKED so a
  // change in ERP's error vocabulary shows up as this number rising instead of as silence.
  return (code === 401 || code === 403);
}

let failed = 0, truncated = 0, denied = 0, withRows = 0;
let tokenDead = 0, otherFail = 0, unmarkedDenial = 0;
const failureSamples = [];
const enriched = planDeltas.map(function (d, i) {
  const resp = responses[i] || {};
  const rows = Array.isArray(resp.content) ? resp.content : [];
  const fetchFailed = !Array.isArray(resp.content) &&
    !!(resp.error || resp.status || resp.message || resp.path);
  if (fetchFailed) failed++;
  // The 401 is the KNOWN state of this route on this account, not a surprise, and it is
  // counted separately so a permission grant landing shows up as this number falling to
  // zero rather than as a silent change in verdicts.
  let deniedHere = false, deadHere = false;
  if (fetchFailed) {
    const code = httpCodeOf(resp);
    const text = failureText(resp);
    deadHere = isTokenDead(text);
    deniedHere = !deadHere && isPermissionDenied(code, text);
    if (deadHere) tokenDead++;
    else if (deniedHere) {
      denied++;
      if (text.indexOf('insufficient_permissions') === -1) unmarkedDenial++;
    } else otherFail++;
    // A bounded sample of the raw shapes, so the next person debugging this reads what ERP
    // and n8n actually sent instead of inferring it from a counter. No ids, no amounts.
    if (failureSamples.length < 3) failureSamples.push(text.slice(0, 220));
  }
  if (rows.length > 0) withRows++;

  const declared = Object.prototype.hasOwnProperty.call(resp, 'totalElements') ? resp.totalElements : null;
  const declaredUsable = declared !== null && declared !== '' && Number.isFinite(Number(declared));
  const isTruncated = declaredUsable ? rows.length < Number(declared) : null;
  if (isTruncated === true) truncated++;

  return {
    case_key: d.case_key,
    contract_id: d.contract_id,
    client_id: d.client_id,
    plan: d.plan,
    replacements: rows.map(function (r) {
      // oldHousemaid / newHousemaid are an object {id,label} OR an EMPTY STRING.
      // newHousemaid === "" means the maid left with NO SUCCESSOR - the signal gate 7 turns
      // on - so a truthiness or null check must handle it explicitly.
      function maid(v) {
        if (v && typeof v === 'object') return { id: s(v.id), label: s(v.label) };
        return { id: '', label: '', empty: true };
      }
      return {
        // ERP's own docs spell this field two ways; read both rather than silently getting
        // an empty date and dropping the event from the timeline.
        date: s(r.replacementDate || r.replacmentDate).slice(0, 10),
        old_housemaid: maid(r.oldHousemaid),
        new_housemaid: maid(r.newHousemaid),
        old_days_with_client: Number.isFinite(Number(r.oldHousemaidDaysSpentWithClient))
          ? Number(r.oldHousemaidDaysSpentWithClient) : null,
        reason: s(r.replacementReason),
        done: r.done === true
      };
    }),
    replacements_meta: {
      fetch_failed: fetchFailed,
      permission_denied: deniedHere,
      token_dead: deadHere,
      rows: rows.length,
      declared_total: declaredUsable ? Number(declared) : null,
      // This endpoint DOES carry a real totalElements, so a short read is visible here -
      // unlike the payment sweep. A truncated walk would hide a maid change and move a
      // verdict, so it is flagged rather than assumed complete.
      truncated: isTruncated
    }
  };
});

// A DEAD TOKEN IS NOT A DATA STATE. Every read after the token dies comes back empty, and
// an empty replacement history reads as "the original maid is still there" - which closes
// gate 7's coverage question in the client's favour on cases nobody actually looked at. So
// this throws rather than returning a chunk of confidently unenriched cases. A permission
// denial does NOT throw: it is the known steady state and gate 7 is built for it.
if (tokenDead > 0) {
  throw new Error('WF-E: ' + tokenDead + ' of ' + responses.length + ' replacement reads came back ' +
    'as a DEAD TOKEN (logout / unauthenticated / 498), not a permission denial. Every read after ' +
    'a token dies is empty, and an empty maid history scores as "no change" - so this chunk would ' +
    'clear cases nobody read. Re-issue the bearer and re-run. Sample: ' +
    (failureSamples[0] || '(none captured)'));
}

// EVERY CANDIDATE COMES BACK, including the ones whose calls failed. A chunk that returned
// fewer deltas than it was given would leave WF-A holding cases with no enrichment and no
// way to tell that from a case that was never sent - which is how a contract gets scored
// against a rate nobody read.
if (enriched.length !== planDeltas.length) {
  throw new Error('WF-E: returning ' + enriched.length + ' deltas for ' + planDeltas.length +
    ' candidates. The caller cannot distinguish a missing delta from an unsent candidate.');
}

console.log(JSON.stringify({ stage: 'wfe_project_replacements', candidates: enriched.length,
  replacement_fetch_failures: failed, permission_denied: denied,
  permission_denied_unmarked: unmarkedDenial, token_dead: tokenDead, other_failures: otherFail,
  failure_samples: failureSamples,
  with_replacement_rows: withRows, truncated_histories: truncated,
  note: 'ONE item out; the raw plan and replacement bodies die with this sub-execution, ' +
        'which is the entire point of the workflow' }));

// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site chunk
//
// Pacing (§1) bounds requests per second. The pre-flight gate (§3) bounds how many there
// are. Neither notices that ERP has ALREADY STARTED FAILING and keeps feeding it the
// remaining ten thousand calls. This does. Aborting loses a run; not aborting loses ERP.
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
  const src = $('Read Chunk').first().json || {};
  const runId = String(src.run_id || '');
  const t0 = Number(src.erp_t0);
  const elapsed = Number.isFinite(t0) && t0 > 0 ? Date.now() - t0 : null;

  const sd = erpBreakerStatic();
  // A new run must not inherit the previous run's baseline: ERP at 9am and ERP at 9pm are not
  // the same server, and comparing across runs would trip on the time of day.
  if (sd && sd.erp_breaker_run !== runId) { sd.erp_breaker_run = runId; sd.erp_breaker_baseline = {}; }
  const base = (sd && sd.erp_breaker_baseline) || {};

  const v = erpBreakerEvaluate({
    phase: opts.phase, responses: opts.responses,
    elapsedMs: elapsed, callsMade: opts.callsMade,
    baselineMsPerCall: base[opts.key]
  });

  console.log(JSON.stringify({ stage: 'erp_breaker', phase: opts.phase, key: opts.key,
    run_id: runId || null, chunk_index: src.chunk_index === undefined ? null : src.chunk_index,
    total: v.total, counts: v.counts, degraded_rate: v.degraded_rate,
    consecutive_max: v.consecutive_max, ms_per_call: v.ms_per_call,
    baseline_ms_per_call: v.baseline_ms_per_call, baseline_carried: v.baseline_carried,
    latency_multiple: v.latency_multiple, tripped: v.trip ? v.trip.code : null,
    static_data_available: sd !== null,
    note: 'ERP-LOAD-POLICY.md §5. auth failures are counted but are NOT degradation - the ' +
          'permanent 401 on every replacement call would otherwise trip this on call five of ' +
          'every run ever fired' }));

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
// --- call site: the WHOLE CHUNK ---------------------------------------------------------
// Measured from Read Chunk's stamp, so this covers BOTH phases and is divided by both phases'
// calls. It is a chunk mean, not a replacements mean, and it is named that way on purpose: the
// two HTTP nodes cannot be timed apart without a stamp between them, and adding a field to
// every delta to carry one would cross the WF-E boundary for the sake of a number.
erpBreakerGuard({
  phase: 'Project Replacements (WF-E)',
  key: 'chunk',
  responses: responses,
  callsMade: responses.length * 2,
  minCallsForBaseline: 200
});
// =================== END ERP CIRCUIT BREAKER ===================

return [{ json: {
  enriched: enriched,
  _projected_by: 'CC Below Agreed - 0-Enrich Candidates',
  _candidates: enriched.length,
  _plan_fetch_failures: $('Project Plan').all().filter(function (i) {
    return i.json.plan && i.json.plan.fetch_failed === true; }).length,
  _replacement_fetch_failures: failed,
  _replacement_permission_denied: denied,
  _replacement_permission_denied_unmarked: unmarkedDenial,
  _replacement_other_failures: otherFail,
  _chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index
} }];
