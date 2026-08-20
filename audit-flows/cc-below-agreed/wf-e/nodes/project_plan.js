// Project Plan (WF-E) - the EXPECTED side: gates 3, 4 and the inputs for gate 5.
//
// LIFTED FROM WF-A's Attach Plan AND IT MUST STAY BEHAVIOURALLY IDENTICAL. Only two
// things changed, both mechanical: the pairing source is Read Chunk rather than
// Needs enrichment?, and every regex is written with character classes instead of
// backslash escapes (see the note on parseDiscount). If the reasoning below and WF-A's
// copy ever disagree, WF-A's is not the survivor - this one runs.
//
// v1 architecture note, carried over verbatim because it is why the shape looks like this:
// runOnceForAllItems, paired positionally, emitting a slim delta. This is the shape the
// sibling check had to be rewritten into after it crashed out of memory - per-item
// $('Node').item lookups walk the pairing chain, and rebuilding the full case at each
// stage retains a copy per stage.
const cases = $('Read Chunk').all().map(function (i) { return i.json; });
const responses = $input.all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

if (responses.length !== cases.length) {
  throw new Error('Project Plan: ' + responses.length + ' plan responses for ' + cases.length +
    ' candidates. Positional pairing is broken - a contract would be priced from another ' +
    'contract\'s plan. The HTTP node above runs alwaysOutputData with onError ' +
    'continueRegularOutput precisely so the counts cannot drift; if they have drifted, one of ' +
    'those two settings was lost.');
}

// ---------------------------------------------------------------- discounts
// BOTH DISCOUNT FIELDS ARE PROSE WITH A DURATION INSIDE THE VALUE, and both come back as
// "" when absent - so x != null is TRUE, defaults never fire, and Number("") is 0 and
// finite. "Credit Note Amount: 0 applied on Service Fee" is a NON-EMPTY string describing
// a ZERO discount, so testing the raw field for truthiness reads no discount as a real one.
//
// "Discount Amount: 1000 applied on Service Fee over 4 months" is 250 A MONTH, not 1000 off
// this month. Subtracting 1000 over-credits by 750 and turns a real shortfall green.
//
// THE REGEXES USE CHARACTER CLASSES, NOT BACKSLASH ESCAPES - [.] for a literal dot,
// [ ] for a space - because this body is shipped into an n8n Code node as a string and a
// backslash class is exactly what gets eaten in transit. [.] is exactly equivalent to
// the original backslash-dot. [ ]+ is NARROWER than the original backslash-s-plus: it will
// not match across a newline or a tab. The text is single-line ERP prose, and the newlines
// are flattened to spaces below before matching, so the two agree on every input this sees.
// offline/enrich_test.js runs both forms over the same strings and asserts they agree.
function parseDiscount(raw) {
  const text = s(raw);
  if (!text.trim()) return { present: false, text: '', amount: 0, months: null, per_month: 0 };
  // Flatten newlines/tabs with String.fromCharCode rather than an escape, for the reason
  // above, so over-N-month behaves like the original whitespace-class version.
  const flat = text.split(String.fromCharCode(10)).join(' ')
                   .split(String.fromCharCode(13)).join(' ')
                   .split(String.fromCharCode(9)).join(' ');
  const m = /(-?[0-9][0-9,]*(?:[.][0-9]+)?)/.exec(flat);
  const value = m ? Number(String(m[1]).replace(/,/g, '')) : 0;
  const dm = /over[ ]+([0-9]+)[ ]+month/i.exec(flat);
  const months = dm ? Number(dm[1]) : null;
  const finite = Number.isFinite(value);
  return {
    present: finite && value > 0,
    text: text,
    amount: finite ? value : 0,
    months: months,
    per_month: (finite && months && months > 0) ? r2(value / months) : (finite ? value : 0)
  };
}

// ---------------------------------------------------------- plan-line dates
// WHY THIS EXISTS, and it is a false-clearance fix rather than a nicety. Probed live
// 2026-08-19 on three brand-new contracts (1103085/86/97): currentPayment.amountValue
// returned the ONE-TIME first-month figure, not the recurring rate, and it equalled what
// the client had just paid - so the case scored as exactly-paid and self-cleared. On
// 1101305 the reverse: the plan's recurring schedule had not started, the client paid a
// stated one-time amount, and currentPayment returned the FULL monthly rate - which would
// have reported that contract as ~58% short. Both errors come from the same blind spot:
// nothing read WHEN the monthly schedule begins.
//
// The plan prose carries it. Measured over 44 live contracts, the date on the (Monthly)
// line is the RECURRING-SCHEDULE START, not a next-payment date: median +0.8 months after
// startOfContract, 40 of 44 within 0-2.5 months, and it stays fixed in the past on old
// contracts (1014657 started 2022-07-12, line reads 2022-08-01). So a (Monthly) line
// dated after the audited month means no monthly payment was due that month.
//
// Line shape: "Service Fees: <net> + <vat> VAT, on Sep 1 2026 (Monthly)". The date sits
// between ", on " and " (", and can be the literal word "Today".
const PLAN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parsePlanLineDate(line) {
  const t = s(line);
  const at = t.indexOf(', on ');
  if (at === -1) return { date: '', raw: '', is_today: false };
  const rest = t.slice(at + 5);
  const close = rest.indexOf(' (');
  const chunk = (close === -1 ? rest : rest.slice(0, close)).trim();
  if (chunk.toLowerCase() === 'today') return { date: '', raw: chunk, is_today: true };
  const parts = chunk.split(' ').filter(function (x) { return x.length > 0; });
  if (parts.length < 3) return { date: '', raw: chunk, is_today: false };
  const mon = PLAN_MONTHS[parts[0].slice(0, 3).toLowerCase()];
  const day = Number(String(parts[1]).replace(',', ''));
  const year = Number(parts[2]);
  if (!mon || !Number.isFinite(day) || !Number.isFinite(year) || day < 1 || day > 31) {
    return { date: '', raw: chunk, is_today: false };
  }
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return { date: year + '-' + pad(mon) + '-' + pad(day), raw: chunk, is_today: false };
}

let unreadable = 0, withDiscount = 0, oneMonth = 0, firstMonthStub = 0, fetchFailures = 0;
let tokenDead = 0;
const planFailureSamples = [];

// SAME CLASSIFIER AS Project Replacements, and here for the same reason: n8n's
// continueRegularOutput returns an ERROR OBJECT, not the HTTP body, so resp.status is
// undefined and String(resp.error) is '[object Object]'. This side never had a detector at
// all - fetch_failed was counted and then nothing looked at WHY - which meant a token dying
// mid-enrichment presented as a run where the expected amount was merely "unknown" on
// thousands of contracts. Unknown is a legitimate verdict for one contract and a silent
// write-off of the book for all of them.
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
let datedMonthlyLines = 0, undatedMonthlyLines = 0;
const out = cases.map(function (c, i) {
  const resp = responses[i] || {};
  const plan = resp.paymentPlan || {};
  const fetchFailed = !resp.paymentPlan && !resp.currentPayment && !!(resp.error || resp.status || resp.path);
  if (fetchFailed) {
    fetchFailures++;
    const text = failureText(resp);
    if (isTokenDead(text)) tokenDead++;
    if (planFailureSamples.length < 3) planFailureSamples.push(text.slice(0, 220));
  }

  // ---- GATE 3: the expected amount is the contract's OWN rate ------------
  // currentPayment.amountValue, VAT-INCLUSIVE, exactly as returned.
  // NEVER the price card - that is the third sibling check, with its own five cohorts and
  // 49 dated windows, and none of its constants belong here.
  // NEVER multiply by 1.05: agreed x 1.05 matches 0 of 5,612 contracts, so adding VAT
  // would flag the entire population.
  // NOT paymentPlan.monthlyAmount (does not exist) and NOT nextMonthlyPaymentAmount (holds
  // the NEXT SCHEDULED payment and is blank when none is scheduled - blank even on ACTIVE
  // contracts).
  const raw = resp.currentPayment ? resp.currentPayment.amountValue : undefined;
  const amount = Number(raw);
  const known = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(amount);
  if (!known) unreadable++;

  const additional = parseDiscount(plan.additionalDiscount);
  const creditNote = parseDiscount(plan.creditNoteDiscount);
  if (additional.present || creditNote.present) withDiscount++;

  // ---- GATE 4: discounts -------------------------------------------------
  // DELIBERATE DEPARTURE FROM THE RULE AS WRITTEN, AND IT IS FLAGGED ON THE CASE.
  // Gate 4 (Order 40) says:
  //     expected = expected_gross - (additionalDiscount / its months) - PAYMENT_ITEM_DISCOUNT
  // Implemented literally that DOUBLE-CREDITS, and the spec's own test case proves it.
  // Contract 1097602, July 2026, verified live: currentPayment.amountValue = 4,452 WITH
  // additionalDiscount "Discount Amount: 1000 applied on Service Fees over 4 months"
  // (= 250/month), and the client paid 2,252 + 2,200 = exactly 4,452. If the 250 were still
  // to be subtracted the expectation would be 4,202 and that correct payment would read as a
  // 250 OVERPAYMENT. The ERP Variables row says the same in words: "additionalDiscount is
  // already reflected inside the contract's own payment plan; never subtract it a second
  // time."
  //
  // So: the discount is NOT subtracted here. It is carried as evidence, and
  // gate4_departure is set so the reviewer can see the rule and the code disagree and
  // rule on it. PAYMENT_ITEM_DISCOUNT lives in Snowflake, which this n8n instance cannot
  // reach at all, so it is recorded as unavailable rather than silently treated as zero.
  const expectedGross = known ? r2(amount) : null;

  // paymentsInfo IS FREE TEXT and must be parsed, not read as fields. The label alternates
  // between 'Service Fee' and 'Service Fees'. A '(One Time Payment)' line is the
  // first-month stub, NOT the recurring rate - reading element 0 and assuming it is the
  // monthly is wrong.
  const paymentsInfo = Array.isArray(plan.paymentsInfo) ? plan.paymentsInfo.map(s) : [];
  const monthlyLine = paymentsInfo.filter(function (l) { return /[(]Monthly[)]/i.test(l); })[0] || '';
  const oneTimeLines = paymentsInfo.filter(function (l) { return /[(]One[ ]*Time/i.test(l); });
  const oneTimeLine = oneTimeLines[0] || '';
  if (oneTimeLine) firstMonthStub++;
  const monthlyDate = parsePlanLineDate(monthlyLine);
  const oneTimeDates = oneTimeLines.map(parsePlanLineDate)
    .filter(function (d) { return d.date || d.is_today; })
    .map(function (d) { return d.is_today ? 'TODAY' : d.date; });
  if (monthlyDate.date) datedMonthlyLines++; else if (monthlyLine) undatedMonthlyLines++;

  // ---- GATE 5 inputs: the pro-rating skip branches -----------------------
  // ERP's own formula (CalculateDiscountsWithVatService.getProRatedAmount) has three
  // branches that skip the day-count entirely, so the flow must look for them rather than
  // always dividing:
  //   1. firstMonthPayment set (and not a one-month agreement) -> use it outright
  //   2. a stored dailyRateAmount > 0 (not one-month) -> use that daily rate
  //   3. isOneMonthAgreement (ACC-5712) -> force the division branch
  const firstMonthPayment = num(resp.firstMonthPayment !== undefined ? resp.firstMonthPayment
                                                                    : plan.firstMonthPayment);
  const dailyRateAmount = num(resp.dailyRateAmount !== undefined ? resp.dailyRateAmount
                                                                : plan.dailyRateAmount);
  const isOneMonthAgreement = (resp.isOneMonthAgreement === true) || (plan.isOneMonthAgreement === true);
  if (isOneMonthAgreement) oneMonth++;

  return { json: {
    // The ids travel on so the replacement fetch below has a contract to ask about and the
    // caller has a key to join on.
    case_key: s(c.case_key),
    contract_id: s(c.contract_id),
    client_id: s(c.client_id),
    plan: {
      fetch_failed: fetchFailed,
      expected_gross: expectedGross,
      expected_amount_known: known,
      expected_basis: 'currentPayment.amountValue, VAT-inclusive, the contract\'s own agreed rate',
      // The single most important caveat on this check. This field is the CONTRACTUAL rate
      // and is NOT reliably what was billed: on 1054346, 1086789 and 1090543 it read
      // 4,715 / 4,715 / 5,712 while the client was billed and paid 2,100 / 2,100 / 3,360 for
      // three to four consecutive months, and BOTH numbers were sent to the same client in
      // writing by two template families. A gap against it is a CANDIDATE. Gate 13 is what
      // turns one into a finding.
      rate_is_contractual_not_billed: true,
      payments_info: paymentsInfo,
      monthly_info_line: monthlyLine,
      one_time_line: oneTimeLine,
      // GATE 35's inputs. The scorer side compares monthly_schedule_starts against the
      // audited month; it is emitted as a plain date rather than a verdict because WF-E does
      // not know which month is being audited, and the gate decision belongs downstream.
      monthly_schedule_starts: monthlyDate.date,
      monthly_schedule_starts_raw: monthlyDate.raw,
      monthly_schedule_date_is_today: monthlyDate.is_today,
      one_time_dates: oneTimeDates,
      // MEASURED 2026-08-19 AND LOAD-BEARING FOR ANYONE READING THESE LINES: the amounts in
      // paymentsInfo prose are EX-VAT, at exactly 1.05 against currentPayment.amountValue on
      // four contracts. Comparing a prose amount to currentPayment without adding VAT would
      // report a 5% shortfall on the whole compliant population. Nothing in this flow reads
      // the prose amounts - only the DATES - and it should stay that way.
      plan_line_amounts_are_ex_vat: true,
      additional_discount: additional,
      credit_note_discount: creditNote,
      gate4_departure: (additional.present || creditNote.present) ? {
        rule_says: 'subtract additionalDiscount / its stated months from the expected amount',
        code_does: 'does NOT subtract - currentPayment.amountValue already reflects it',
        evidence: 'contract 1097602: rate 4,452 WITH a 1000-over-4-months discount, and 4,452 ' +
                  'was exactly what the client paid. Subtracting 250 would report a 250 overpayment.',
        needs_ruling: true
      } : null,
      snowflake_item_discount: 'UNAVAILABLE - CONTRACT_PAYMENT_PLAN_ITEMS.PAYMENT_ITEM_DISCOUNT is a ' +
        'Snowflake field and this n8n instance has no Snowflake credential. Recorded as unavailable, ' +
        'never as zero: on 1097602 the item discount was 0 while the term discount was 1000, so they ' +
        'are different facts and assuming either is a guess.',
      first_month_payment: firstMonthPayment,
      daily_rate_amount: dailyRateAmount,
      is_one_month_agreement: isOneMonthAgreement
    }
  } };
});

// A DEAD TOKEN IS NOT A DATA STATE - it throws, exactly as on the replacement side. An
// unreadable plan makes expected_amount_known false, and gate 3 then answers "cannot tell"
// instead of scoring. That is the right answer for one contract whose plan is genuinely
// missing. Applied to a whole chunk because the bearer expired at 22:00 UTC mid-run, it is a
// book-wide write-off dressed up as a careful verdict.
if (tokenDead > 0) {
  throw new Error('WF-E: ' + tokenDead + ' of ' + responses.length + ' plan reads came back as a ' +
    'DEAD TOKEN (logout / unauthenticated / 498). Every ERP token issued in a day dies at 22:00 ' +
    'UTC / 02:00 Dubai, and a token can also be killed early by a logout elsewhere. Those cases ' +
    'would score as "expected amount unknown" - a write-off of the book presented as caution. ' +
    'Re-issue the bearer and re-run. Sample: ' + (planFailureSamples[0] || '(none captured)'));
}
// A chunk in which EVERY plan read failed is never a data state either, whatever the reason.
// The route was measured at 3,851 B and 1.80 s on 7 of 7 test contracts (probe #12).
if (responses.length > 0 && fetchFailures === responses.length) {
  throw new Error('WF-E: all ' + responses.length + ' plan reads in this chunk failed. ' +
    'get-client-details answered 200 on 7 of 7 probed contracts, so a clean sweep of failures is ' +
    'access, pagecode or shape - never every contract missing a plan. Sample: ' +
    (planFailureSamples[0] || '(none captured)'));
}

console.log(JSON.stringify({ stage: 'wfe_project_plan', candidates: out.length,
  plan_fetch_failures: fetchFailures, unreadable_expected_amount: unreadable,
  plan_token_dead: tokenDead, plan_failure_samples: planFailureSamples,
  with_a_discount: withDiscount, one_month_agreements: oneMonth,
  with_first_month_stub: firstMonthStub,
  dated_monthly_lines: datedMonthlyLines, undated_monthly_lines: undatedMonthlyLines }));

// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) =====================
// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js
// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site plan
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
// --- call site: the PLAN phase of this chunk ------------------------------------------------
// `responses` above is one item per candidate, in input order, straight from Fetch Contract Plan.
// A trip here stops this chunk's SECOND phase before it fires, which is 750 calls not made -
// the only mid-chunk saving available, because the HTTP node returns only when its last request
// is done and nothing of ours runs before then.
erpBreakerGuard({
  phase: 'Project Plan (WF-E)',
  key: 'plan',
  responses: responses,
  callsMade: responses.length,
  minCallsForBaseline: 200
});
// =================== END ERP CIRCUIT BREAKER ===================

return out;
