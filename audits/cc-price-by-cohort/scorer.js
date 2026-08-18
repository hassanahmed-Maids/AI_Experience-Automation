// ---------------------------------------------------------------------------
// CC Client Paying According to Price by Type / Nationality / Start Date
// DETERMINISTIC SCORER - gates in ACP order. Offline harness at the bottom.
//
// Order is load-bearing:
//   3 cohort -> 4 unpriceable -> 7 living switch -> 10 discounts -> 8 tolerance
//   -> 9 five tests -> 12 carry-forward -> 13 unexplained (LAST)
// ---------------------------------------------------------------------------

const TOLERANCE = 3.0; // AED absolute, never a percentage (VAT rounding artefact)

// --- card -------------------------------------------------------------------
// Dates arrive as M/D/YYYY from the Sheet. NEVER string-compare them.
function parseCardDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}
function parseIso(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function cohortKey(bucket, liveOut) {
  return (liveOut ? 'liveout' : 'livein') + ':' + bucket;
}

// GATE 3: three buckets, and the mapping is AXIS-DEPENDENT.
// Live-out has NO Ethiopian cohort - a live-out Ethiopian prices as Other.
// That is why there are 5 cohorts, not 6.
function bucketOf(nationality, liveOut) {
  const v = String(nationality || '').trim().toLowerCase();
  if (v === '') return null; // empty string, not null, on maid-less contracts
  if (v === 'filipina') return 'Filipina';
  if (v === 'ethiopian') return liveOut ? 'Other' : 'Ethiopian';
  return 'Other';
}

// Window lookup. The final window of each cohort is OPEN-ENDED: its end date is
// =TODAY() recalculated live, so never treat "after the last end" as unpriced.
function priceAt(card, cohort, whenMs) {
  if (whenMs === null) return null;
  const list = card.filter((w) => w.cohort === cohort);
  if (!list.length) return null;
  let latestStart = -Infinity;
  for (const w of list) {
    const s = parseCardDate(w.start);
    if (s !== null && s > latestStart) latestStart = s;
  }
  const hits = [];
  for (const w of list) {
    const s = parseCardDate(w.start);
    const e = parseCardDate(w.end);
    if (s === null) continue;
    const isFinal = s === latestStart;
    if (whenMs >= s && (isFinal || (e !== null && whenMs <= e))) hits.push(w);
  }
  // Windows within a cohort are non-overlapping by construction. More than one
  // match means the CARD IS CORRUPT - stop the run, never pick one.
  if (hits.length > 1) {
    const err = new Error('CARD CORRUPT: ' + hits.length + ' overlapping windows for ' + cohort);
    err.cardCorrupt = true;
    throw err;
  }
  return hits.length ? hits[0].price_inc_vat : null;
}

// The run date. Injectable so tests stay deterministic, but it DEFAULTS TO REAL
// TODAY - a hardcoded date silently mis-prices every "current price" comparison
// the moment the card gains a new window.
function todayMs() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function priceNow(card, cohort, asOfMs) {
  return priceAt(card, cohort, asOfMs === undefined || asOfMs === null ? todayMs() : asOfMs);
}

function historicPrices(card, cohort) {
  return card.filter((w) => w.cohort === cohort).map((w) => w.price_inc_vat);
}

// GATE 10: discounts are PROSE WITH A DURATION, in two fields.
// "Discount Amount: 1000 applied on Service Fee over 4 months" is 250/month.
// Both fields return "" (not null, not 0) when absent - coerce, never truthiness.
function parseDiscount(text) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  if (raw === '') return { monthly: 0, present: false };
  const amt = raw.match(/([\d,]+(?:\.\d+)?)/);
  if (!amt) return { monthly: 0, present: false };
  const total = Number(amt[1].replace(/,/g, ''));
  if (!isFinite(total) || total === 0) return { monthly: 0, present: false }; // "Amount: 0" is a real zero
  const months = raw.match(/over\s+(\d+)\s+month/i);
  const n = months ? Number(months[1]) : 1;
  return { monthly: total / (n > 0 ? n : 1), present: true };
}

function score(c, card, opts) {
  const asOfMs = opts && opts.asOfMs !== undefined ? opts.asOfMs : null;
  const out = {
    contract_id: c.contract_id,
    tests: {},
    reason_code: null,
    state: null,
    verdict: null,
    needs_human: false,
    gap_aed: null,
    flags: [],
  };

  // --- GATE 3: cohort key ---------------------------------------------------
  const liveOutNow = c.live_out;
  if (liveOutNow === null || liveOutNow === undefined || liveOutNow === '') {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_living_axis';
    out.needs_human = true;
    return out; // GATE 4: never default to live-in, it is the cheaper cohort
  }
  const bucketNow = bucketOf(c.maid_nationality, liveOutNow);
  if (bucketNow === null) {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_nationality';
    out.needs_human = true;
    return out; // never default to Other - it is the CHEAPEST live-in bucket
  }
  out.cohort_now = cohortKey(bucketNow, liveOutNow);

  // --- GATE 7: living switch -----------------------------------------------
  // Today's axis is not necessarily the axis in force at contract start. The
  // price-at-start axis is the OLDEST log's oldValue.
  const startMs = parseIso(c.contract_start_date);
  let liveOutAtStart = liveOutNow;
  const logs = Array.isArray(c.live_in_out_logs) ? c.live_in_out_logs.slice() : [];
  const switched = logs.some((l) => {
    const d = parseIso(l.date);
    return d !== null && startMs !== null && d > startMs;
  });
  if (switched) {
    logs.sort((a, b) => (parseIso(a.date) || 0) - (parseIso(b.date) || 0));
    const oldest = logs[0];
    liveOutAtStart = String(oldest.oldValue).toUpperCase() === 'OUT';
    out.flags.push('living_switch');
    out.needs_human = true; // the 207-contract class routes to the verifier
  }
  const bucketAtStart = bucketOf(c.maid_nationality, liveOutAtStart);
  out.cohort_at_start = bucketAtStart ? cohortKey(bucketAtStart, liveOutAtStart) : null;

  // --- expectation ---------------------------------------------------------
  let pNow, pStart;
  try {
    pNow = priceNow(card, out.cohort_now, asOfMs);
    pStart = out.cohort_at_start ? priceAt(card, out.cohort_at_start, startMs) : null;
  } catch (e) {
    if (e.cardCorrupt) throw e;
    throw e;
  }
  const history = historicPrices(card, out.cohort_now).concat(
    out.cohort_at_start && out.cohort_at_start !== out.cohort_now
      ? historicPrices(card, out.cohort_at_start)
      : []
  );

  // GATE 4: no cohort or no window -> unpriceable, and a NULL never satisfies
  // a comparison. price_at_start NULL must score NOT PASSED, never passed.
  if (pNow === null && pStart === null) {
    out.state = 'pending';
    out.verdict = 'Unpriceable';
    out.reason_code = 'no_window_covers_date';
    out.needs_human = true;
    return out;
  }

  // The live-out card BEGINS 2024-07-15. A contract that started before its
  // cohort's first window has NO price-at-start - the 21-contract class. Flagged
  // explicitly so it is visible rather than inferred from a false test result.
  if (pStart === null && startMs !== null) {
    out.flags.push('unpriceable_at_start');
    out.needs_human = true;
  }

  // --- GATE 10: discounts narrow the expectation BEFORE any gap test -------
  const addl = parseDiscount(c.additional_discount);
  const cnote = parseDiscount(c.credit_note_discount);
  // additionalDiscount is ALREADY reflected in the contract's own payment plan.
  // Never subtract it a second time - that double-credits and turns a real
  // shortfall green. Carried as verifier context only.
  if (addl.present) out.flags.push('additional_discount_context_only');
  if (cnote.present) out.flags.push('credit_note_discount_context_only');
  // The plan-item discount has NO CONFIRMED ERP ROUTE. If a verdict would turn
  // on it, route to the verifier rather than defaulting it to zero.
  if (c.plan_item_discount_unreadable) out.flags.push('plan_item_discount_unreadable');

  // --- actual --------------------------------------------------------------
  const actual = Number(c.agreed_monthly_rate);
  if (!isFinite(actual)) {
    out.state = 'pending';
    out.verdict = "Can't tell";
    out.reason_code = 'no_stored_rate';
    out.needs_human = true;
    return out; // never fall back to the card as the expectation
  }

  // --- GATES 8 + 9: five tests, tolerance 3.00 absolute --------------------
  const within = (exp) => exp !== null && Math.abs(actual - exp) <= TOLERANCE;

  out.tests.price_now = within(pNow);
  out.tests.price_at_contract_start = within(pStart);
  // "old price" means equality to ANY window in the cohort's history, not the
  // covering one, and NOT a >= floor reading (that only reaches 88.91%).
  out.tests.any_historic_price = history.some((p) => Math.abs(actual - p) <= TOLERANCE);
  // NOT IMPLEMENTED - no definition exists on the spec pages. Scored NOT PASSED
  // by decision; in the labelled set these clear 17 and 13 rows, so the residue
  // is overstated by up to ~30 and must be reported as such.
  out.tests.upgrading_nationality = false;
  out.tests.pro_rated = false;
  out.unimplemented_tests = ['upgrading_nationality', 'pro_rated'];

  const anyPassed =
    out.tests.price_now || out.tests.price_at_contract_start || out.tests.any_historic_price;

  if (anyPassed) {
    out.state = 'green';
    out.verdict = out.tests.price_now ? 'Priced correctly' : 'Grandfathered';
    out.reason_code = out.tests.price_now ? 'matches_current_card' : 'matches_published_price';
    // A PASSING TEST MUST NOT CLEAR A CONTRACT THAT A GATE ALREADY ROUTED.
    // A living-switch contract read its price-at-start off a possibly wrong
    // cohort history, so "it matches some published price" is exactly the
    // false clearance gate 7 exists to prevent. needs_human is one-way.
    if (out.needs_human) {
      out.state = 'pending';
      out.verdict = "Can't tell";
      out.reason_code = 'cleared_on_a_test_but_gate_requires_review';
    }
    return out;
  }

  // --- GATE 15 (verifier trigger): payment term priced for another nationality
  if (c.payment_term_nationality_surface === 'unavailable') {
    out.flags.push('cpt_surface_unavailable');
    out.pil_blocked = true; // hardest verdict capped while a surface is unread
  } else if (
    c.payment_term_nationality &&
    String(c.payment_term_nationality).trim().toLowerCase() !==
      String(c.maid_nationality).trim().toLowerCase()
  ) {
    out.flags.push('payment_term_nationality_mismatch');
  }

  // --- GATE 13: LAST. Unexplained is a QUESTION, never an established loss.
  const expected = pNow !== null ? pNow : pStart;
  out.gap_aed = Math.round((expected - actual) * 100) / 100;
  out.needs_human = true; // routed to the verifier, never auto-reported as loss

  // RECORDED DECISION (build-handover s9 q2): a contract whose cohort had no
  // published price at its start date scores PENDING/Unpriceable, not a red
  // finding. The gap versus today's card is still written for the verifier -
  // the information is kept, only the CLAIM is withheld. Naming a client as
  // under-priced against a price that was never published is an assertion the
  // evidence does not support. Both labels route to a human either way.
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

module.exports = { score, parseDiscount, priceAt, priceNow, bucketOf, parseCardDate, todayMs };
