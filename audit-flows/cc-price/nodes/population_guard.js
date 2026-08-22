// THE BREAKER RUNS FIRST, before anything below can throw.
//
// Every refusal in this node - the shape check, the short-read check - reports a CAUSE, and the
// shape check's cause is "the account lacks the getactivecccontracts grant". That is the right
// answer for a SecurityException and the wrong one for a 500 storm, and it would send whoever
// reads it to check permissions while ERP is falling over. The breaker classifies what actually
// came back and, crucially, counts auth separately from degradation.
//
// This node reads the population pages, so it is the projection node for that batch under
// ERP-LOAD-POLICY.md section 5. `responses` is the raw page items; `pages` below is the same
// list, kept under its original name so the rest of this node is unchanged.
const pages = $input.all();
const responses = pages.map(function (i) { return i.json; });
const ERP_BREAKER_PHASE = 'Population Guard (CC Price Stage 1)';

// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site pages --source-node "Build Page List"
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
  const src = $('Build Page List').first().json || {};
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
// --- call site: a PAGED SWEEP that enumerates its own pages ---------------------------------
// One item per page, straight from the population fetch, in page order.
//
// BE HONEST ABOUT WHAT CAN FIRE HERE, because a breaker that looks present and cannot speak is
// worse than none. A population sweep is ~12 pages, so of the three detectors:
//   - consecutive (5)     CAN fire. Five pages failing in a row is ERP falling over, and this
//                         is the last gate before the per-entity phase spends ~16,000 calls.
//   - rate (>=20 samples) CANNOT. Twelve responses never reach the minimum, by design: a
//                         quarter of twelve is three, and three bad pages is not a diagnosis.
//   - latency (3x)        CANNOT. The baseline is only ever taken from a batch of >=200 calls,
//                         so a 12-call sweep neither sets one nor is measured against one.
//
// AND IT DOES NOT CHANGE WHETHER THIS RUN STOPS. The guard below this block already refuses on
// a single malformed page, which is stricter than five. What the breaker changes is WHAT THE
// OPERATOR IS TOLD: the shape check reports "expected a bare array... the account lacks the
// grant", which is the wrong diagnosis to hand someone while ERP is on fire, and it counts auth
// separately so a dead token is never reported as degradation. Per section 5 the message is the
// thing anyone actually reads at the moment a run dies.
//
// It must therefore run BEFORE the shape check, or the shape check throws first and this never
// speaks.
erpBreakerGuard({
  phase: ERP_BREAKER_PHASE,
  key: 'pages',
  responses: responses,
  callsMade: responses.length,
  minCallsForBaseline: 200
});
// =================== END ERP CIRCUIT BREAKER ===================

const src = $("Parse + Assert Card").first().json;
const params = src.params;
const card = src.price_card;
const cfg = params.population;
const SIZE = 500;

// The dynamic API returns no `total`, so completeness cannot be self-reported.
// The independent count comes from a DIFFERENT route on purpose.
let independent = null;
try {
  const ic = $("Get Independent Count").first().json;
  const t = ic && ic.total;
  if (t !== undefined && t !== null) independent = Number(t);
} catch (e) { independent = null; }

const rows = [];
const problems = [];

// THREE CLASSES OF PAGE, and they have different legal row counts. Getting this
// wrong aborted run 92512 on correct data:
//   interior      (0 .. n-3)  must be exactly SIZE
//   last data     (n-2)       holds the remainder, so 1..SIZE is legal
//   probe         (n-1)       fetched past the end, must be 0
// With total 5401 and SIZE 500: pages 0-9 are 500, page 10 is 401, page 11 is 0.
const probeIdx = pages.length - 1;
const lastDataIdx = pages.length - 2;

for (let i = 0; i < pages.length; i++) {
  const body = (pages[i].json || {}).body;
  if (!Array.isArray(body)) {
    throw new Error("POPULATION SHAPE UNEXPECTED on page " + i + ": expected a bare array. A SecurityException body here means the account lacks the getactivecccontracts grant. Run stopped; no contract was scored.");
  }
  if (i === probeIdx) {
    // Rows here mean the population outgrew the independent count mid-run, so
    // this pull is short by an unknown amount.
    if (body.length !== 0) {
      problems.push("the probe page past the expected end returned " + body.length + " rows, so the population extends beyond the independent count and this pull is incomplete");
    }
  } else if (i === lastDataIdx) {
    if (body.length === 0 || body.length > SIZE) {
      problems.push("the last data page returned " + body.length + " rows, which is outside the legal 1.." + SIZE);
    }
  } else if (body.length !== SIZE) {
    // A short interior page is how the flattened-body trap manifests: HTTP 200
    // with paging silently ignored.
    problems.push("interior page " + i + " returned " + body.length + " rows instead of " + SIZE);
  }
  for (const r of body) rows.push(r);
}

const seen = {};
const contracts = [];
let dupes = 0;
for (const r of rows) {
  const id = String(r.contractId === undefined || r.contractId === null ? "" : r.contractId);
  if (!id) continue;
  if (seen[id]) { dupes++; continue; }
  seen[id] = true;
  // THIS PROJECTION IS THE PII BOUNDARY. Source rows carry clientName and
  // maidName; neither is needed to price a contract, and neither travels past
  // this line into the baton, the Cases table, or any report.
  contracts.push({
    contract_id: id,
    client_id: String(r.clientId === undefined || r.clientId === null ? "" : r.clientId),
    maid_nationality: r.maidNationality === undefined ? null : r.maidNationality,
    live_out: r.maidLiveOut === undefined ? null : r.maidLiveOut,
    contract_start_date: r.startDate === undefined ? null : r.startDate,
    // Needed to decide whether the contract was active for the WHOLE audit
    // month. A contract terminated part-way through M is out of scope for M,
    // which is what removes the pro-rating problem instead of modelling it.
    scheduled_termination: r.scheduledDateOfTermination === undefined ? null : r.scheduledDateOfTermination
  });
}

const count = contracts.length;
const delta = independent === null ? null : count - independent;
const deltaPct = (independent === null || independent === 0) ? null : Math.abs(delta) / independent * 100;

// This is the check that actually proves nothing was missed. The page-shape
// rules above catch a broken pager early with a clearer message, but the count
// reconciliation is the one that matters.
if (independent === null) {
  problems.push("no independent count available, so completeness cannot be proven");
} else if (count < independent) {
  problems.push("SHORT READ: fetched " + count + " of " + independent + " contracts (" + (independent - count) + " missing)");
} else if (deltaPct !== null && deltaPct > cfg.max_divergence_pct) {
  problems.push("population diverges from the independent count by " + deltaPct.toFixed(2) + "%");
}
if (problems.length) {
  throw new Error("POPULATION GUARD FAILED: " + problems.join("; ") + ". Run stopped; no contract was scored. Partial results are never emitted.");
}

const soft = [];
if (count < cfg.abort_below) soft.push("population " + count + " is below the abort floor " + cfg.abort_below);
const warn = count >= cfg.abort_below && count < cfg.warn_below;
if (soft.length && !cfg.warn_only) {
  throw new Error("POPULATION GUARD FAILED: " + soft.join("; ") + ". Run stopped; no contract was scored.");
}

let withNat = 0;
for (const c of contracts) { if (c.maid_nationality !== null && String(c.maid_nationality).trim() !== "") withNat++; }

return [{ json: {
  params: params,
  price_card: card,
  population: {
    count: count,
    independent_count: independent,
    delta: delta,
    delta_pct: deltaPct,
    duplicates_dropped: dupes,
    pages_fetched: pages.length,
    page_size: SIZE,
    complete: soft.length === 0 && !warn,
    guard: soft.length ? "below-floor-warn-only" : (warn ? "warn-band" : "ok"),
    guard_notes: soft.join("; "),
    source: "dynamicApi/getactivecccontracts",
    with_nationality: withNat,
    without_nationality: count - withNat
  },
  contracts: contracts
} }];
