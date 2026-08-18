// ===========================================================================
// STAGE 2 "Score Batch" CODE NODE BODY.
// Ported from ../scorer.js. The gate order is load-bearing - see that file.
// Everything the ERP could not tell us resolves to null/"" and routes to a
// human. NOTHING here defaults a missing input to a value, because a defaulted
// input clears a contract that was never actually examined.
// ===========================================================================
const TOLERANCE = 3.0;

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
function cohortKey(bucket, liveOut) { return (liveOut ? 'liveout' : 'livein') + ':' + bucket; }

// Live-out has NO Ethiopian cohort - a live-out Ethiopian prices as Other.
function bucketOf(nationality, liveOut) {
  const v = String(nationality || '').trim().toLowerCase();
  if (v === '') return null;
  if (v === 'filipina') return 'Filipina';
  if (v === 'ethiopian') return liveOut ? 'Other' : 'Ethiopian';
  return 'Other';
}

function priceAt(card, cohort, whenMs) {
  if (whenMs === null) return null;
  const list = [];
  for (const w of card) { if (w.cohort === cohort) list.push(w); }
  if (!list.length) return null;
  let latestStart = -Infinity;
  for (const w of list) { const s = parseCardDate(w.start); if (s !== null && s > latestStart) latestStart = s; }
  const hits = [];
  for (const w of list) {
    const s = parseCardDate(w.start);
    const e = parseCardDate(w.end);
    if (s === null) continue;
    const isFinal = s === latestStart;
    if (whenMs >= s && (isFinal || (e !== null && whenMs <= e))) hits.push(w);
  }
  if (hits.length > 1) {
    const err = new Error('CARD CORRUPT: ' + hits.length + ' overlapping windows for ' + cohort);
    err.cardCorrupt = true;
    throw err;
  }
  return hits.length ? hits[0].price_inc_vat : null;
}
function historicPrices(card, cohort) {
  const out = [];
  for (const w of card) { if (w.cohort === cohort) out.push(w.price_inc_vat); }
  return out;
}
function parseDiscount(text) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  if (raw === '') return { monthly: 0, present: false };
  const amt = raw.match(/([\d,]+(?:\.\d+)?)/);
  if (!amt) return { monthly: 0, present: false };
  const total = Number(amt[1].replace(/,/g, ''));
  if (!isFinite(total) || total === 0) return { monthly: 0, present: false };
  const months = raw.match(/over\s+(\d+)\s+month/i);
  const n = months ? Number(months[1]) : 1;
  return { monthly: total / (n > 0 ? n : 1), present: true };
}

function score(c, card, asOfMs) {
  const out = { contract_id: c.contract_id, tests: {}, reason_code: null, state: null, verdict: null, needs_human: false, gap_aed: null, flags: [], expected_now: null, expected_at_start: null };

  const liveOutNow = c.live_out;
  if (liveOutNow === null || liveOutNow === undefined || liveOutNow === '') {
    out.state = 'pending'; out.verdict = 'Unpriceable'; out.reason_code = 'no_living_axis'; out.needs_human = true;
    return out; // never default to live-in, it is the cheaper cohort
  }
  const bucketNow = bucketOf(c.maid_nationality, liveOutNow);
  if (bucketNow === null) {
    out.state = 'pending'; out.verdict = 'Unpriceable'; out.reason_code = 'no_nationality'; out.needs_human = true;
    return out; // never default to Other, it is the CHEAPEST live-in bucket
  }
  out.cohort_now = cohortKey(bucketNow, liveOutNow);

  const startMs = parseIso(c.contract_start_date);
  let liveOutAtStart = liveOutNow;
  const logs = Array.isArray(c.live_in_out_logs) ? c.live_in_out_logs.slice() : [];
  let switched = false;
  for (const l of logs) {
    const d = parseIso(l.date);
    if (d !== null && startMs !== null && d > startMs) { switched = true; break; }
  }
  if (switched) {
    logs.sort(function (a, b) { return (parseIso(a.date) || 0) - (parseIso(b.date) || 0); });
    liveOutAtStart = String(logs[0].oldValue).toUpperCase() === 'OUT';
    out.flags.push('living_switch');
    out.needs_human = true;
  }
  const bucketAtStart = bucketOf(c.maid_nationality, liveOutAtStart);
  out.cohort_at_start = bucketAtStart ? cohortKey(bucketAtStart, liveOutAtStart) : null;

  const pNow = priceAt(card, out.cohort_now, asOfMs);
  const pStart = out.cohort_at_start ? priceAt(card, out.cohort_at_start, startMs) : null;
  out.expected_now = pNow;
  out.expected_at_start = pStart;

  let history = historicPrices(card, out.cohort_now);
  if (out.cohort_at_start && out.cohort_at_start !== out.cohort_now) {
    for (const p of historicPrices(card, out.cohort_at_start)) history.push(p);
  }

  if (pNow === null && pStart === null) {
    out.state = 'pending'; out.verdict = 'Unpriceable'; out.reason_code = 'no_window_covers_date'; out.needs_human = true;
    return out;
  }
  if (pStart === null && startMs !== null) {
    out.flags.push('unpriceable_at_start');
    out.needs_human = true;
  }

  const addl = parseDiscount(c.additional_discount);
  const cnote = parseDiscount(c.credit_note_discount);
  // additionalDiscount is ALREADY in the contract's payment plan. Subtracting it
  // again double-credits and turns a real shortfall green.
  if (addl.present) out.flags.push('additional_discount_context_only');
  if (cnote.present) out.flags.push('credit_note_discount_context_only');
  if (c.plan_item_discount_unreadable) out.flags.push('plan_item_discount_unreadable');

  const actual = Number(c.agreed_monthly_rate);
  if (!isFinite(actual)) {
    out.state = 'pending'; out.verdict = "Can't tell"; out.reason_code = 'no_stored_rate'; out.needs_human = true;
    return out; // never fall back to the card as the expectation
  }

  const within = function (exp) { return exp !== null && Math.abs(actual - exp) <= TOLERANCE; };
  out.tests.price_now = within(pNow);
  out.tests.price_at_contract_start = within(pStart);
  let anyHist = false;
  for (const p of history) { if (Math.abs(actual - p) <= TOLERANCE) { anyHist = true; break; } }
  out.tests.any_historic_price = anyHist;
  // NOT IMPLEMENTED - no definition exists on the spec pages. Scored NOT PASSED.
  out.tests.upgrading_nationality = false;
  out.tests.pro_rated = false;
  out.unimplemented_tests = ['upgrading_nationality', 'pro_rated'];

  const anyPassed = out.tests.price_now || out.tests.price_at_contract_start || out.tests.any_historic_price;
  if (anyPassed) {
    out.state = 'green';
    out.verdict = out.tests.price_now ? 'Priced correctly' : 'Grandfathered';
    out.reason_code = out.tests.price_now ? 'matches_current_card' : 'matches_published_price';
    // needs_human is ONE-WAY. A passing test must never clear a gate-routed contract.
    if (out.needs_human) {
      out.state = 'pending'; out.verdict = "Can't tell";
      out.reason_code = 'cleared_on_a_test_but_gate_requires_review';
    }
    return out;
  }

  if (c.payment_term_nationality_surface === 'unavailable') {
    out.flags.push('cpt_surface_unavailable');
    out.pil_blocked = true;
  } else if (c.payment_term_nationality && String(c.payment_term_nationality).trim().toLowerCase() !== String(c.maid_nationality).trim().toLowerCase()) {
    out.flags.push('payment_term_nationality_mismatch');
  }

  const expected = pNow !== null ? pNow : pStart;
  out.gap_aed = Math.round((expected - actual) * 100) / 100;
  out.needs_human = true;
  if (out.flags.indexOf('unpriceable_at_start') !== -1) {
    out.state = 'pending'; out.verdict = 'Unpriceable'; out.reason_code = 'no_published_price_at_start';
    return out;
  }
  out.state = 'red'; out.verdict = 'Under-priced'; out.reason_code = 'below_card_unexplained';
  return out;
}

// --- field extraction ------------------------------------------------------
// The fallback route does not carry cohort inputs inline, so they come from
// get-client-details. The exact key paths are NOT yet probe-confirmed, so each
// field is tried against several plausible paths and, when none resolves, is
// left NULL and recorded in extraction_unresolved. A null routes the contract
// to a human via the gates above - it never silently becomes a value.
function pick(obj, paths) {
  for (const p of paths) {
    let cur = obj;
    let ok = true;
    for (const seg of p.split('.')) {
      if (cur === null || cur === undefined || typeof cur !== 'object' || !(seg in cur)) { ok = false; break; }
      cur = cur[seg];
    }
    if (ok && cur !== null && cur !== undefined && cur !== '') return { value: cur, path: p };
  }
  return { value: null, path: null };
}

function coerceBool(v) {
  if (v === true || v === false) return v;
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (s === '') return null;              // blank is NOT false
  if (s === 'true' || s === 'yes' || s === 'out' || s === 'live-out' || s === 'liveout' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'in' || s === 'live-in' || s === 'livein' || s === '0') return false;
  return null;
}

function extract(details, searchRow, cptPayload, logsPayload) {
  const unresolved = [];
  const sources = {};
  const g = function (name, obj, paths) {
    const r = pick(obj || {}, paths);
    if (r.path === null) unresolved.push(name); else sources[name] = r.path;
    return r.value;
  };

  // PROBE-CONFIRMED PATHS (2026-08-18, contract 1005750 / client 10458).
  // Every path below was read off a live 200 response, not guessed.
  const liveOutRaw = g('live_out', { d: details, s: searchRow },
    ['s.liveOut', 'd.liveOut', 's.housemaid.liveOut']);          // contract-level and housemaid-level agreed on 40/40 rows
  const startDate = g('contract_start_date', { d: details, s: searchRow },
    ['s.startOfContract', 'd.contractStartDate']);
  const rate = g('agreed_monthly_rate', { d: details },
    ['d.currentPayment.amountValue']);
  const addl = g('additional_discount', { d: details },
    ['d.paymentPlan.additionalDiscount']);                        // NOT top level - it is under paymentPlan
  const cnote = g('credit_note_discount', { d: details },
    ['d.paymentPlan.creditNoteDiscount']);

  // Payment-term nationality comes from getActiveCptInfo, which is a SEPARATE
  // call and was 401 at the 2026-08-17 baseline. `nationality` there is the
  // TERM's nationality (cptName provably contains it), which is exactly the
  // gate-15 comparison value - it is NOT the maid's nationality.
  const cptNat = g('payment_term_nationality', { c: cptPayload }, ['c.nationality']);

  // THE MAID'S OWN NATIONALITY HAS NO CONFIRMED SURFACE ON THE FALLBACK PATH.
  // It is null on contract/search/page (housemaid carries only id/label/
  // travelAssist/liveOut) and absent from CONTRACT_DETAILS except inside
  // replacements[]. Deriving it from the last replacement only works for
  // contracts that had one, so it is NOT derived here. Left null, which routes
  // the contract to a human via the no_nationality gate rather than guessing a
  // cohort - guessing would land on "Other", the cheapest live-in bucket, and
  // manufacture false clearances at scale.
  const nationality = g('maid_nationality', { d: details, s: searchRow },
    ['s.housemaid.nationality', 'd.housemaid.nationality', 'd.maidNationality']);

  const logs = [];
  const arr = Array.isArray(logsPayload) ? logsPayload : (logsPayload && Array.isArray(logsPayload.content) ? logsPayload.content : []);
  for (const l of arr) {
    logs.push({ date: l.date || null, oldValue: l.oldValue || null, newValue: l.newValue || null });
  }

  return {
    maid_nationality: nationality === null ? '' : String(nationality),
    live_out: coerceBool(liveOutRaw),
    contract_start_date: startDate === null ? null : String(startDate),
    agreed_monthly_rate: rate === null ? NaN : Number(rate),
    additional_discount: addl === null ? '' : String(addl),
    credit_note_discount: cnote === null ? '' : String(cnote),
    payment_term_nationality: cptNat === null ? null : String(cptNat),
    payment_term_nationality_surface: cptNat === null ? 'unavailable' : 'read',
    live_in_out_logs: logs,
    extraction_unresolved: unresolved,
    field_sources: sources,
  };
}

module.exports = { score, extract, parseDiscount, bucketOf, priceAt };
