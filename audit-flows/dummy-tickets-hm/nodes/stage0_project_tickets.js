// SLIM PROJECTION. The parent must never retain a raw applicant tree - the sibling CC chain had
// one sweep return 44.1 MB into its caller. Only the fields the gates and the verifier read
// cross the boundary.
//
// Gate 30's ONE RETRY is n8n's retryOnFail (maxTries 2) on the node upstream, with neverError
// OFF so a 500 genuinely throws and therefore genuinely retries. An item that still failed after
// the retry arrives WITHOUT a statusCode and is scored reachable:false -> the parent records
// erp_unreachable (pending). Never a finding, and never 'applicant not found': ERP returns 500,
// not 404.
//
// The exact path is flightsTickets.requestFlightTicketActions[]. A defensive tree-walk fallback
// exists, but which path produced the rows is REPORTED, so a silent ERP schema change shows up
// in the run instead of emptying the population.

const src = $('Expand Applicants').all().map(function (i) { return i.json; });
if (src.length === 1 && src[0]._no_applicants) return [{ json: { _no_applicants: true } }];

const res = $input.all().map(function (i) { return i.json; });

// FAIL LOUD ON MISALIGNMENT. Responses are paired to applicants BY INDEX, so a dropped or
// duplicated response would attribute one applicant's tickets to another - a wrong finding about
// a named person. Never guess past this.
if (res.length !== src.length) {
  throw new Error('0-Fetch: ' + src.length + ' applicants requested but ' + res.length +
    ' responses returned. Refusing to pair tickets to applicants by index when the counts disagree.');
}

// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site plan --source-node "Expand Applicants"
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
  const src = $('Expand Applicants').first().json || {};
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
// --- call site: this chunk's ticket reads ---------------------------------------------------
// `res` is one item per applicant in this chunk, in input order, straight from Get Hustler
// Tickets. The parent calls this flow with mode:each over chunks of 25, so a trip here stops the
// REMAINING chunks: the parent's Execute Workflow node propagates the throw, and every chunk
// after this one is a batch of 25 calls not made. Within a chunk nothing can be saved - the HTTP
// node returns only when its last request is done, and no code of ours runs before then.
//
// minCallsForBaseline is 20, not the 200 that WF-E uses, because a chunk here is 25 and a
// threshold above the chunk size would mean the baseline is never set and the latency rule never
// fires. The baseline lives in this workflow's static data keyed by run_id, so it is taken from
// the first chunk and applied to the rest of the same run - which is what makes the latency rule
// meaningful HERE and not in the parent, where each fan-out happens exactly once.
erpBreakerGuard({
  phase: 'Project Tickets (Dummy Tickets HM 0-Fetch)',
  key: 'tickets',
  responses: res,
  callsMade: res.length,
  minCallsForBaseline: 20
});
// =================== END ERP CIRCUIT BREAKER ===================

function walkForTickets(nodeVal, acc) {
  if (!nodeVal || typeof nodeVal !== 'object') return;
  if (Array.isArray(nodeVal)) { for (const el of nodeVal) walkForTickets(el, acc); return; }
  if (nodeVal.ticketType !== undefined) { acc.push(nodeVal); return; }
  for (const k of Object.keys(nodeVal)) walkForTickets(nodeVal[k], acc);
}
function lbl(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    const l = (v.label !== undefined && v.label !== null) ? v.label : null;
    const n = (v.name !== undefined && v.name !== null) ? v.name : null;
    return String(l !== null ? l : (n !== null ? n : '')).trim();
  }
  return String(v).trim();
}

// The verifier rules turn on what a person WROTE, so the ticket's own note fields travel too.
// Capped, and only the populated ones are kept - on most tickets this adds nothing at all.
const NOTE_FIELDS = ['notes', 'ticketNotes', 'summary', 'cancellationReason', 'otherReason',
  'otherRefundReason', 'rejectionNotes', 'reasonForHighPrice'];
function notesOf(t) {
  const out = {};
  for (const k of NOTE_FIELDS) {
    const v = lbl(t[k]);
    if (v) out[k] = v.slice(0, 600);
  }
  return out;
}

const out = [];
for (let i = 0; i < src.length; i++) {
  const id = src[i].applicant_id;
  const r = res[i] || {};
  const status = r.statusCode;

  if (status !== 200) {
    out.push({ json: { applicant_id: id, reachable: false,
      http_status: (status === undefined ? null : status),
      erp_error: r.error ? String(r.error.message || r.error).slice(0, 200) : null,
      retried: true, tickets: [], total_rows: 0, path_used: null } });
    continue;
  }

  const body = r.body !== undefined ? r.body : r;
  const exact = body && body.flightsTickets && body.flightsTickets.requestFlightTicketActions;
  let rows, path_used;
  if (Array.isArray(exact)) { rows = exact; path_used = 'exact'; }
  else { rows = []; walkForTickets(body, rows); path_used = rows.length ? 'tree_walk_FALLBACK' : 'none'; }

  const tickets = rows.map(function (t) {
    const notes = notesOf(t);
    return {
      id: t.id !== undefined ? t.id : null,
      ticketType: lbl(t.ticketType),
      status: lbl(t.status),
      ticketOutcome: lbl(t.ticketOutcome),
      amountInAED: (t.amountInAED === undefined ? '' : t.amountInAED),
      currency: lbl(t.currency),
      requestRefundOn: lbl(t.requestRefundOn),
      requestRefundAutomaticallyType: lbl(t.requestRefundAutomaticallyType),
      flightTicketDate: lbl(t.flightTicketDate),
      refundReason: lbl(t.refundReason),
      refundable: t.refundable,
      applicantTask: lbl(t.applicantTask),
      // verifier evidence
      notes: notes,
      has_written_record: Object.keys(notes).length > 0,
      from_code: lbl(t.fromLocationCode), to_code: lbl(t.toLocationCode),
      refund_in: lbl(t.refundIn)
    };
  });

  out.push({ json: { applicant_id: id, reachable: true, http_status: 200,
    retried: false, path_used: path_used, total_rows: rows.length, tickets: tickets } });
}
return out;
