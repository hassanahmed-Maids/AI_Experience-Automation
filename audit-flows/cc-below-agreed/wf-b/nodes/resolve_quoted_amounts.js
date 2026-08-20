// Resolve Quoted Amounts - GATE 14 (Order 140), and the input gate 13 cannot do
// without. It answers one question per candidate: what amount did WE quote to this
// client for this month, and which family quoted it?
//
// WHY A BAKED LOOKUP. ERP's smsLog returns the template NAME plus the parameter
// VALUES - e.g. "{1}: 2,100, {2}: the monthly visa fee and salary" - and nothing
// that says what {1} MEANS. `smsContent` is EMPTY on every WhatsApp row (131
// checked), so the body has to come from somewhere else. The template store is the
// somewhere else, and the bodies below were pulled from it on 2026-08-14 via
// GET /clientmgmt/clientbroadcast/templates + gettemplateinfo. Snowflake also holds
// them, but this n8n instance has no Snowflake credential, so a live read is not an
// option and a baked snapshot is.
//
// RULE 14 SAYS RESOLVE BY NAME, NEVER BY POSITION - and the store makes that
// possible, because ERP does NOT store positional {1}/{2} at all. It stores NAMED
// @param@ tokens; the {n} numbering is Meta's, recovered from the order each token
// first appears in the body. That order is what `order` below records, so the index
// is DERIVED from the name rather than assumed.
//
// MEASURED, AND IT CORRECTS THE SPEC: the amount index is CONSTANT across every
// step of a family - monthly_reminder is {3} at steps 1_1..4_1, and every
// online_reminder variant is {1} at steps 1_1..1_10. It differs only BETWEEN
// families. The spec assumed the index moves between steps; against the live bodies
// it does not. A per-family constant is safe; a single global index would be wrong.
//
// THE TWO FAMILIES ARE THE WHOLE POINT (rule 15):
//   quotes_contract_rate     - acc_cc_client_paying_via_cc_monthly_reminder_*
//                              quotes THIS contract's stored rate. On 1054346 it
//                              said AED 4,715.
//   quotes_requested_amount  - acc_cc_client_online_reminder_*
//                              quotes what accounting actually ASKED FOR. On the
//                              same contract, days later, it said AED 2,100.
// If the client paid what the online_reminder asked and that was below the contract
// rate, we UNDER-BILLED - which the owner ruled on 2026-08-13 IS a finding. If
// accounting asked the contract rate and less arrived, the client UNDERPAID. Same
// money, different teams, and only these templates can tell them apart.
//
// STALENESS IS THE COST OF BAKING, so it is made loud rather than left silent: the
// pull date is stamped, and every message whose template is NOT in the lookup is
// counted and reported. An unknown template makes a case INCONCLUSIVE - it never
// makes it a finding, and it never clears one.
const PULLED_ON = '2026-08-14';
const TEMPLATES = {
 "CC_ACCOUNTING_NOT_OWED_MONEY_FROM_CLIENT_8_1_2_NOTIFICATION": { "amount_index": 1, "amount_param": "amount", "family": "no_amount", "order": ["amount"], "template_id": 4454 },
 "CC_ACCOUNTING_OWE_MONEY_TO_CLIENT_8_1_1_NOTIFICATION": { "amount_index": 1, "amount_param": "remaining_balance", "family": "no_amount", "order": ["remaining_balance"], "template_id": 4456 },
 "acc_cc_client_online_reminder_not_required_multiple_payments_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46086 },
 "acc_cc_client_online_reminder_not_required_multiple_payments_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46088 },
 "acc_cc_client_online_reminder_not_required_one_payment_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 4630 },
 "acc_cc_client_online_reminder_not_required_one_payment_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 4632 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46046 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_10": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_tomorrow"], "template_id": 46054 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46048 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_3": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5143 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_4": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 4739 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_5": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5147 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_6": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5184 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_7": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5677 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_8": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_after_3_days"], "template_id": 46050 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_9": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_after_2_days"], "template_id": 46052 },
 "acc_cc_client_online_reminder_required_one_payment_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 46066 },
 "acc_cc_client_online_reminder_required_one_payment_1_10": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_tomorrow"], "template_id": 46074 },
 "acc_cc_client_online_reminder_required_one_payment_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 46068 },
 "acc_cc_client_online_reminder_required_one_payment_1_3": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5679 },
 "acc_cc_client_online_reminder_required_one_payment_1_4": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5681 },
 "acc_cc_client_online_reminder_required_one_payment_1_5": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5683 },
 "acc_cc_client_online_reminder_required_one_payment_1_6": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5685 },
 "acc_cc_client_online_reminder_required_one_payment_1_7": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5701 },
 "acc_cc_client_online_reminder_required_one_payment_1_8": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_after_3_days"], "template_id": 46070 },
 "acc_cc_client_online_reminder_required_one_payment_1_9": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_after_2_days"], "template_id": 46072 },
 "acc_cc_client_paying_via_cc_monthly_reminder_1_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5149 },
 "acc_cc_client_paying_via_cc_monthly_reminder_2_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5151 },
 "acc_cc_client_paying_via_cc_monthly_reminder_3_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5153 },
 "acc_cc_client_paying_via_cc_monthly_reminder_4_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 23569 },
 "notifiers_du_pay_clients": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["Mr./Ms.","client_first_name","maid_first_name","he/she","his/her","maid_name","download_link","tutorial_link_registration","him/her","tutorial_link_ATM","next_month","maid_country"], "template_id": 53505 },
 "notifiers_du_pay_clients_cc": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["Mr./Ms.","client_first_name","maid_first_name","he/she","his/her","maid_name","download_link","tutorial_link_registration","him/her","tutorial_link_ATM","next_month","maid_country"], "template_id": 54926 },
 "notifiers_settle_payment_reminder": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["paying_via_credit_card_link"], "template_id": 50024 }
};

const cases = $('Select Candidates').all().map(function (i) { return i.json; });
const waResp = $('Get Messages (WhatsApp)').all().map(function (i) { return i.json; });
const smsResp = $('Get Messages (SMS)').all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

if (waResp.length !== cases.length || smsResp.length !== cases.length) {
  throw new Error('Resolve Quoted Amounts: ' + waResp.length + ' WhatsApp and ' + smsResp.length +
    ' SMS responses for ' + cases.length + ' candidates. Positional pairing is broken, so a quoted ' +
    'amount would be attributed to the wrong contract - refusing to guess.');
}

// AMOUNTS ARRIVE BOTH BARE (4715) AND COMMA-GROUPED (2,100), so normalise before
// comparing anything.
function toAmount(raw) {
  const t = s(raw).replace(/AED/ig, '').replace(/,/g, '').trim();
  const m = /(-?[0-9]+(?:\.[0-9]+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// templateContent comes back as the parameter VALUES, keyed by position:
//   "{1}: 2,100, {2}: the monthly visa fee and salary"
// Parse it into an index -> value map. Anything unparseable stays unparsed rather
// than being coerced into a number.
function parseParams(content) {
  const out = {};
  const text = s(content);
  const re = /\{(\d+)\}\s*:\s*([^{]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[Number(m[1])] = s(m[2]).replace(/[,\s]+$/, '').trim();
  }
  return out;
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.content)) return body.content;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}
function fetchFailed(body) {
  if (!body) return true;
  if (body.error) return true;
  return !(Array.isArray(body) || (body && (Array.isArray(body.content) || Array.isArray(body.data))));
}

let unknownTemplates = {}, totalQuotes = 0, failedReads = 0;
// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site messages --source-node "Select Candidates"
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
  const src = $('Select Candidates').first().json || {};
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
// --- call site: BOTH message reads of this batch --------------------------------------------
// The two ERP nodes fan out over the same candidates and land in a Merge, so the batch to judge
// is both of them together: a WhatsApp read that is fine and an SMS read that is failing is a
// failing ERP, and judging them apart would halve the consecutive count on each side and let a
// full outage sit under the threshold twice.
erpBreakerGuard({
  phase: 'Resolve Quoted Amounts (WF-B)',
  key: 'messages',
  responses: waResp.concat(smsResp),
  callsMade: waResp.length + smsResp.length,
  minCallsForBaseline: 200
});
// =================== END ERP CIRCUIT BREAKER ===================

const out = cases.map(function (c, i) {
  const failed = fetchFailed(waResp[i]) || fetchFailed(smsResp[i]);
  if (failed) failedReads++;

  const rows = rowsOf(waResp[i]).map(function (r) { return { ch: 'WHATSAPP', r: r }; })
    .concat(rowsOf(smsResp[i]).map(function (r) { return { ch: 'SMS', r: r }; }));

  const quotes = [];
  for (const item of rows) {
    const r = item.r;
    const name = s(r.templateName);
    // sentDate is the ONLY usable date on this endpoint - creationDate and
    // dateOfMessage are null on every row, and using either makes the whole
    // population read as "nobody was ever told anything".
    const sent = s(r.sentDate).slice(0, 10);
    if (!name) continue;

    const tpl = TEMPLATES[name];
    if (!tpl) { unknownTemplates[name] = (unknownTemplates[name] || 0) + 1; continue; }
    if (tpl.amount_index === null) continue;      // template carries no amount at all

    const params = parseParams(r.templateContent);
    const raw = params[tpl.amount_index];
    const amount = toAmount(raw);
    if (amount === null) {
      unknownTemplates['UNPARSED:' + name] = (unknownTemplates['UNPARSED:' + name] || 0) + 1;
      continue;
    }
    totalQuotes++;
    quotes.push({
      template: name,
      family: tpl.family,
      channel: item.ch,
      sent_date: sent,
      amount: amount,
      // The label matters: on 1097602 "{2}: the monthly visa fee and salary" sat
      // beside a SECOND payment link for a different figure, and reading only the
      // first understates the month by 2,200.
      label: s(params[tpl.amount_index + 1] || ''),
      resolved_by: 'param name "' + s(tpl.amount_param) + '" at position ' + tpl.amount_index +
        ' (derived from the stored body order, not assumed)'
    });
  }

  quotes.sort(function (a, b) { return String(b.sent_date).localeCompare(String(a.sent_date)); });
  const contractRateQuotes = quotes.filter(function (q) { return q.family === 'quotes_contract_rate'; });
  const requestedQuotes = quotes.filter(function (q) { return q.family === 'quotes_requested_amount'; });

  return { json: Object.assign({}, c, {
    quoted: {
      lookup_pulled_on: PULLED_ON,
      templates_known: 33,
      read_failed: failed,
      quotes: quotes,
      // What we told them the contract rate was, and what we actually asked for.
      contract_rate_quoted: contractRateQuotes.length ? contractRateQuotes[0].amount : null,
      requested_quoted: requestedQuotes.length ? requestedQuotes[0].amount : null,
      families_seen: Object.keys(quotes.reduce(function (a, q) { a[q.family] = 1; return a; }, {})),
      // Gate 14's honest limit: no quote at all is NOT evidence that nothing was
      // quoted. It can equally mean the message predates the log window, went by a
      // channel this endpoint does not carry, or used a template the bake does not
      // know. Either way the case is inconclusive, never a finding.
      no_quote_found: quotes.length === 0
    }
  }) };
});

console.log(JSON.stringify({ stage: 'resolve_quoted_amounts', candidates: out.length,
  quotes_resolved: totalQuotes, message_read_failures: failedReads,
  lookup_pulled_on: PULLED_ON, templates_in_lookup: 33,
  unknown_or_unparsed_templates: unknownTemplates,
  note: 'An unknown template makes a case inconclusive. If this map is non-empty the bake needs a ' +
        'refresh from /clientmgmt/clientbroadcast/templates - it is a snapshot, not a live read.' }));

return out;

