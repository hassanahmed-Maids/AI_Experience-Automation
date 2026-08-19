// ---------------------------------------------------------------------------
// MONTH-SCOPED SCORER
//
// Asks "was this contract priced correctly during month M?" instead of
// "is it priced correctly right now?". Design: design-month-scoped-audit.md.
//
// Two things this fixes, both of which produced false findings on 2026-08-18:
//   - the rate no longer comes from currentPayment.amountValue (which is
//     whatever period is current - often a one-time joining fee). It comes from
//     the paymentsInfo entry covering M. See rate-field-is-wrong.md.
//   - partial months are never audited, so pro-rating never needs computing.
//
// OUT OF SCOPE IS A THIRD OUTCOME. It is not a pending and not a finding, and
// it must never enter the denominator green/red/pending are measured against.
// ---------------------------------------------------------------------------

const { priceAt, parseCardDate, parseDiscount, bucketOf } = require('./scorer');
const { resolveMonthlyRate, ym } = require('./paymentsinfo');

const TOLERANCE = 3.0; // AED absolute - a VAT rounding artefact, never a percentage

function parseIso(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 'YYYY-MM' -> {first, last} in UTC ms, inclusive.
function monthBounds(auditMonth) {
  const m = String(auditMonth || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return { first: Date.UTC(y, mo, 1), last: Date.UTC(y, mo + 1, 0), year: y, month: mo };
}

// The current month is NEVER a valid default: on the 18th you cannot say whether
// this month was billed correctly, because it has not finished.
function lastCompletedMonth(nowMs) {
  const d = new Date(nowMs === undefined ? Date.now() : nowMs);
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth() - 1;
  if (mo < 0) { mo = 11; y -= 1; }
  return y + '-' + String(mo + 1).padStart(2, '0');
}

function cohortKey(bucket, liveOut) {
  return (liveOut ? 'liveout' : 'livein') + ':' + bucket;
}

// The living axis in force at instant T, reconstructed from the change log.
// A log entry records a change ON its date from oldValue to newValue, so the
// value at T is the newValue of the latest entry at or before T - and, before
// any entry exists, the oldValue of the earliest one. With no logs the current
// value has always been the value.
function liveOutAt(currentLiveOut, logs, tMs) {
  const list = (Array.isArray(logs) ? logs : [])
    .map(function (l) { return { ms: parseIso(l.date), oldValue: l.oldValue, newValue: l.newValue }; })
    .filter(function (l) { return l.ms !== null; })
    .sort(function (a, b) { return a.ms - b.ms; });
  if (!list.length) return currentLiveOut;
  if (tMs < list[0].ms) return String(list[0].oldValue).toUpperCase() === 'OUT';
  let v = null;
  for (const l of list) { if (l.ms <= tMs) v = l.newValue; }
  return String(v).toUpperCase() === 'OUT';
}

// Did this cohort's card price change part-way through M? A window that STARTS
// after the first of the month but on or before the last means the month had two
// prices. Flag it and hand it to a human - do not average, do not pick.
function cardChangedMidMonth(card, cohort, bounds) {
  return card.some(function (w) {
    if (w.cohort !== cohort) return false;
    const s = parseCardDate(w.start);
    return s !== null && s > bounds.first && s <= bounds.last;
  });
}

// Prices published on or before the first of M. A price that only came into
// existence AFTER the audit month cannot grandfather a contract during it.
function historicPricesUpTo(card, cohort, tMs) {
  return card
    .filter(function (w) {
      if (w.cohort !== cohort) return false;
      const s = parseCardDate(w.start);
      return s !== null && s <= tMs;
    })
    .map(function (w) { return w.price_inc_vat; });
}

function outOfScope(out, reason, detail) {
  out.scope = 'out_of_scope';
  out.scope_reason = reason;
  out.state = null;
  out.verdict = null;
  out.reason_code = null;
  out.needs_human = false;
  if (detail) out.scope_detail = detail;
  return out;
}

// contract fields consumed:
//   contract_id, maid_nationality, live_out, contract_start_date,
//   date_of_termination, scheduled_date_of_termination,
//   payments_info (array of ERP strings), live_in_out_logs,
//   additional_discount, credit_note_discount,
//   payment_term_nationality, payment_term_nationality_surface
function scoreMonth(c, card, opts) {
  const auditMonth = (opts && opts.audit_month) || lastCompletedMonth(opts && opts.nowMs);
  const bounds = monthBounds(auditMonth);
  if (!bounds) throw new Error('audit_month must be YYYY-MM, got: ' + auditMonth);

  const out = {
    contract_id: c.contract_id,
    audit_month: auditMonth,
    scope: 'in_scope',
    scope_reason: null,
    tests: {},
    reason_code: null,
    state: null,
    verdict: null,
    needs_human: false,
    gap_aed: null,
    actual_rate: null,
    card_price: null,
    cohort: null,
    flags: [],
  };

  // --- SCOPE: active for the WHOLE month -----------------------------------
  const startMs = parseIso(c.contract_start_date);
  if (startMs === null) return outOfScope(out, 'no_start_date');
  if (startMs > bounds.first) {
    // Started mid-M. Not audited for M; it enters the population for M+1.
    // This is what removes the brand-new-contract problem - no pro-rating,
    // no inferred rate, no special gate.
    return outOfScope(out, 'started_after_month_start', c.contract_start_date);
  }
  const termCandidates = [c.date_of_termination, c.scheduled_date_of_termination]
    .map(parseIso)
    .filter(function (v) { return v !== null; });
  const termMs = termCandidates.length ? Math.min.apply(null, termCandidates) : null;
  if (termMs !== null && termMs < bounds.last) {
    return outOfScope(out, 'terminated_before_month_end', new Date(termMs).toISOString().slice(0, 10));
  }

  // --- RATE: from paymentsInfo, selected for M -----------------------------
  // An EMPTY plan is not the same as "entries exist, none covers M". The first
  // means the plan could not be read and is a pending; only the second is a
  // legitimate out-of-scope. Collapsing them would drop contracts out of the
  // denominator for a reason that is actually a data failure.
  if (!Array.isArray(c.payments_info) || c.payments_info.length === 0) {
    out.state = 'pending';
    out.verdict = "Can't tell";
    out.reason_code = 'no_payment_plan';
    out.needs_human = true;
    return out;
  }
  const rates = resolveMonthlyRate(c.payments_info, bounds.first, startMs);
  out.parse_failures = rates.parse_failures.length;

  if (rates.parse_failures.length) {
    // Never silently skip a line: the dropped entry could be the rate being
    // audited. And never fall back to currentPayment.
    out.state = 'pending';
    out.verdict = "Can't tell";
    out.reason_code = 'rate_unreadable';
    out.needs_human = true;
    out.unreadable_lines = rates.parse_failures.map(function (f) { return f.raw; });
    return out;
  }
  if (rates.applicable.length === 0) {
    return outOfScope(out, 'no_rate_for_month',
      rates.monthly_entries.length ? 'monthly entries exist but none covers ' + auditMonth
                                   : 'no monthly entry at all (one-time only)');
  }
  if (rates.applicable.length > 1) {
    out.state = 'pending';
    out.verdict = "Can't tell";
    out.reason_code = 'multiple_rates_in_month';
    out.needs_human = true;
    out.rate_entries = rates.applicable.map(function (e) { return e.raw; });
    return out;
  }
  const entry = rates.applicable[0];
  out.actual_rate = entry.amount;
  out.rate_entry = entry.raw;
  // An introductory rate below card IS flagged for the months it applies. That
  // is a policy call recorded on 2026-08-19: report what was true that month and
  // let a human clear an approved promotion through needs_human, exactly as the
  // living-switch class is cleared. The flag exists so the human sees WHY.
  if (entry.duration_months !== null) out.flags.push('bounded_rate_period');

  // --- COHORT, as of the audit month ---------------------------------------
  const liveOutInMonth = liveOutAt(c.live_out, c.live_in_out_logs, bounds.first);
  if (liveOutInMonth === null || liveOutInMonth === undefined || liveOutInMonth === '') {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_living_axis';
    out.needs_human = true;
    return out; // never default to live-in, it is the cheaper cohort
  }
  const bucket = bucketOf(c.maid_nationality, liveOutInMonth);
  if (bucket === null) {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_nationality';
    out.needs_human = true;
    return out; // never default to Other - the cheapest live-in bucket
  }
  out.cohort = cohortKey(bucket, liveOutInMonth);

  // A switch INSIDE M means the contract sat in two cohorts that month. Unlike
  // the run-date scorer, a switch that completed before M is not ambiguous here:
  // the axis in force during M is fully determined, so only an in-month switch
  // routes to a human.
  const switchedInMonth = (Array.isArray(c.live_in_out_logs) ? c.live_in_out_logs : []).some(function (l) {
    const d = parseIso(l.date);
    return d !== null && d >= bounds.first && d <= bounds.last;
  });
  if (switchedInMonth) {
    out.flags.push('living_switch_in_month');
    out.needs_human = true;
  }

  // --- CARD, as of the first of M ------------------------------------------
  if (cardChangedMidMonth(card, out.cohort, bounds)) {
    out.flags.push('card_changed_mid_month');
    out.state = 'pending';
    out.verdict = "Can't tell";
    out.reason_code = 'card_changed_mid_month';
    out.needs_human = true;
    return out; // two published prices that month - never average, never pick
  }
  const pMonth = priceAt(card, out.cohort, bounds.first); // throws on a corrupt card
  out.card_price = pMonth;

  const cohortAtStart = (function () {
    const lo = liveOutAt(c.live_out, c.live_in_out_logs, startMs);
    const b = bucketOf(c.maid_nationality, lo);
    return b ? cohortKey(b, lo) : null;
  })();
  const pStart = cohortAtStart ? priceAt(card, cohortAtStart, startMs) : null;

  if (pMonth === null && pStart === null) {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_window_covers_month';
    out.needs_human = true;
    return out;
  }
  // The live-out card BEGINS 2024-07-15. A contract older than its cohort's
  // first window has no price-at-start; flag it rather than let a false test
  // result imply one.
  if (pStart === null) {
    out.flags.push('unpriceable_at_start');
    out.needs_human = true;
  }

  // --- discounts narrow the expectation BEFORE any gap test ----------------
  // additionalDiscount is ALREADY reflected in the contract's own payment plan,
  // so subtracting it here would double-credit and turn a real shortfall green.
  // Carried as verifier context only.
  if (parseDiscount(c.additional_discount).present) out.flags.push('additional_discount_context_only');
  if (parseDiscount(c.credit_note_discount).present) out.flags.push('credit_note_discount_context_only');
  if (c.plan_item_discount_unreadable) out.flags.push('plan_item_discount_unreadable');

  // --- the tests -----------------------------------------------------------
  const actual = out.actual_rate;
  const within = function (exp) { return exp !== null && Math.abs(actual - exp) <= TOLERANCE; };
  const history = historicPricesUpTo(card, out.cohort, bounds.first).concat(
    cohortAtStart && cohortAtStart !== out.cohort ? historicPricesUpTo(card, cohortAtStart, bounds.first) : []
  );

  out.tests.price_in_month = within(pMonth);
  out.tests.price_at_contract_start = within(pStart);
  out.tests.any_historic_price = history.some(function (p) { return Math.abs(actual - p) <= TOLERANCE; });
  // No definition exists on the spec pages, so it is scored NOT PASSED by
  // decision and declared, never quietly assumed false.
  out.tests.upgrading_nationality = false;
  out.unimplemented_tests = ['upgrading_nationality'];
  // pro_rated is RETIRED by month scoping: a partial month is out of scope, so
  // there is no pro-rated payment left to test for.
  out.retired_tests = ['pro_rated'];

  const anyPassed = out.tests.price_in_month || out.tests.price_at_contract_start || out.tests.any_historic_price;

  if (anyPassed) {
    out.state = 'green';
    out.verdict = out.tests.price_in_month ? 'Priced correctly' : 'Grandfathered';
    out.reason_code = out.tests.price_in_month ? 'matches_card_for_month' : 'matches_published_price';
    // needs_human is ONE-WAY. A passing test must not clear a contract a gate
    // already routed - that is exactly the false clearance the gates exist for.
    if (out.needs_human) {
      out.state = 'pending';
      out.verdict = "Can't tell";
      out.reason_code = 'cleared_on_a_test_but_gate_requires_review';
    }
    return out;
  }

  if (c.payment_term_nationality_surface === 'unavailable') {
    out.flags.push('cpt_surface_unavailable');
  } else if (
    c.payment_term_nationality &&
    String(c.payment_term_nationality).trim().toLowerCase() !== String(c.maid_nationality).trim().toLowerCase()
  ) {
    out.flags.push('payment_term_nationality_mismatch');
  }

  const expected = pMonth !== null ? pMonth : pStart;
  out.gap_aed = Math.round((expected - actual) * 100) / 100;
  out.needs_human = true; // a question for the verifier, never an established loss

  if (out.flags.indexOf('unpriceable_at_start') !== -1) {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_published_price_at_start';
    return out;
  }

  out.state = 'red';
  out.verdict = 'Under-priced';
  out.reason_code = 'below_card_unexplained';
  return out;
}

module.exports = { scoreMonth, monthBounds, lastCompletedMonth, liveOutAt, cardChangedMidMonth, TOLERANCE };
