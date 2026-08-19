// Compute Case States - the scorer for CC Monthly Payments Below Agreed Amount.
//
// IT CANNOT PRODUCE A FINDING. That is the defining property of this check and the
// reason gate 13 exists: `currentPayment.amountValue` is the CONTRACTUAL rate and
// is NOT reliably what was billed. On 1054346 / 1086789 / 1090543 it read
// 4,715 / 4,715 / 5,712 while the client was billed and paid 2,100 / 2,100 / 3,360
// for three to four consecutive months - and BOTH numbers were sent to the same
// client in writing, days apart, by two different template families. So arithmetic
// alone can only ever produce a CANDIDATE. Red is the verifier's to give, under
// rules 14/15/16, after reading what we actually told the client.
//
// ORDER IS LOAD-BEARING and has one hard dependency: everything that NARROWS the
// expectation (40 discounts, 50 pro-rating) must run before 110 applies the
// tolerance, 70 identity/coverage must precede anything reading coverage, and 130
// must be LAST because its whole job is to catch what the others could not explain.
// A 130 that ran earlier would red the freeze and pro-rate cases - the 4-of-4 false
// positive this spec was built to avoid.
//
//   10  nothing received      -> green   out_of_scope_nothing_received   (sibling's finding)
//   20  completeness          -> aborts upstream in Verify Bulk Pulls
//   30  expected = own rate   -> unknown -> reason_code 'unscored', verifier-bound
//       (the portal shows it as inconclusive; it is never green and never a finding)
//   40  discounts            -> evidence; NOT subtracted (see Attach Plan)
//   50  pro-rating           -> green   prorated_first_month
//   60  freeze overlap       -> green   freeze_overlap / verifier if unbuildable
//   70  maid coverage        -> green   no_maid_coverage / pro-rate partial
//   80  actual = Monthly Payment, plus other non-refund types ONLY where they close
//       the gap EXACTLY (leftover <= tolerance). An unevidenced split is declined
//       and the case goes to the verifier, never to a green.
//   90  refund netting       -> MP-reversing netted; anything else -> verifier
//  100  covered month        -> HALF BUILT. paymentDate places the payment in the
//       period; the billing cycle that decides which month it SETTLES is not
//       available, so an unnetted overpayment is flagged to the verifier instead.
//  110  tolerance AED 5.00   -> green paid_in_full / overpaid, or a candidate
//  120  in flight            -> pending payment_in_flight
//  125  exception register   -> INERT on run 1 (clean slate, owner's ruling)
//  128  persistence          -> candidate strength; single month -> verifier only
//  130  quoted amount        -> EVERY candidate routes to the verifier. No red here.
const validated = $('Validate Inputs').first().json;
const WINDOWS = validated.persistence_windows || [];
const auditKey = WINDOWS.length ? WINDOWS[0].key : validated.audit_month;
const rangeStart = validated.range_start;
const rangeEnd = validated.range_end;

function s(v) { return v === null || v === undefined ? '' : String(v); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function ymd(v) { return s(v).slice(0, 10); }

// GATE 11: AED 5.00 ABSOLUTE, and never a percentage. Raised from 0.50 by the
// owner on 2026-08-13, measured to reclassify only 3 of ~985 July shortfalls - it
// absorbs VAT- and pro-rate-rounding noise without hiding a real case. ERP rounds
// VAT (a 4,714.50 card price is stored 4,715.0), which is why an absolute band and
// not a ratio. NEVER borrow the price-card check's 3.00.
const TOLERANCE = 5.00;

// Gate 13's own rule text still reads `expected - 0.50`, a constant left over from
// before the owner settled the tolerance at 5.00 on the same day. The settled value
// governs; the stale text is flagged in the handover for correction on the rule row
// rather than silently honoured or silently ignored.
const STALE_RULE_CONSTANT_NOTE = 'gate 13 rule text says 0.50; settled tolerance is 5.00 (2026-08-13)';

function daysInMonth(yyyy_mm) {
  const y = Number(s(yyyy_mm).slice(0, 4)), m = Number(s(yyyy_mm).slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// GATE 5: ERP's own pro-rating, confirmed against
// CalculateDiscountsWithVatService.getProRatedAmount (lines 391-412):
//   dailyAmount   = monthly / daysIn(the pro-rated date's OWN calendar month)
//   remainingDays = daysBetween(start, lastDayOfThatMonth) + 1   // both ends inclusive
//   result        = Math.round(remainingDays * dailyAmount)      // half-UP
// Verified to the dirham on 1101890: started 31 Jul, rate 5,712, collected 184 =
// 5712/31. Companions 1101830/1101868 started 30 Jul and collected 369. The divisor
// is days in the CALENDAR month - /30 would give 380.8, which is not 369.
// NEVER port the manual runs' `Pro-Rated` column: it uses a fixed per-cohort
// constant as numerator (4301/3549/5299/4232), unrounded and frozen since 2025.
function proRate(monthly, startDate, monthKey) {
  const dim = daysInMonth(monthKey);
  const startDay = Number(ymd(startDate).slice(8, 10));
  const remaining = dim - startDay + 1;          // inclusive of both ends
  const daily = monthly / dim;
  return { amount: Math.round(remaining * daily), days: remaining, days_in_month: dim, daily: daily };
}

// GATE 7: coverage from the replacement walk, never the tag date. On 1054346 the
// contract's tag date reads 2026-08-03 while July was fully covered, because the
// outgoing maid left 12:28 and the incoming arrived 13:35 THE SAME DAY (26 Jun).
// A same-day swap is NOT a coverage gap.
function coveredDays(replacements, meta, monthKey, monthFrom, monthTo, contractStart) {
  const dim = daysInMonth(monthKey);
  if (meta && meta.fetch_failed) return { known: false, days: null, why: 'replacement_fetch_failed' };
  if (meta && meta.truncated === true) return { known: false, days: null, why: 'replacement_history_truncated' };

  const rows = (Array.isArray(replacements) ? replacements.slice() : [])
    .filter(function (r) { return !!r.date; })
    .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

  // No replacement records is NOT "no maid was ever placed" - far more often the
  // original maid is still there and coverage starts at the contract's own date.
  if (rows.length === 0) {
    if (!contractStart) return { known: false, days: null, why: 'no_replacements_and_no_start_date' };
    if (contractStart > monthTo) return { known: true, days: 0, why: 'contract starts after the month' };
    const from = contractStart > monthFrom ? contractStart : monthFrom;
    return { known: true, days: dim - Number(from.slice(8, 10)) + 1, why: 'no replacement records' };
  }

  let placed = !!contractStart && contractStart <= monthTo;
  let gapOpenedOn = null, covered = 0, cursor = monthFrom;
  for (const row of rows) {
    if (row.date < monthFrom) { placed = !row.new_housemaid.empty; continue; }
    if (row.date > monthTo) break;
    if (placed) covered += Number(row.date.slice(8, 10)) - Number(cursor.slice(8, 10)) + (cursor === monthFrom ? 1 : 0);
    const leftWithNoSuccessor = row.new_housemaid.empty;
    if (leftWithNoSuccessor) gapOpenedOn = row.date; else if (gapOpenedOn === row.date) gapOpenedOn = null;
    placed = !leftWithNoSuccessor;
    cursor = row.date;
  }
  if (placed) covered += dim - Number(cursor.slice(8, 10)) + (cursor === monthFrom ? 1 : 0);
  if (covered > dim) covered = dim;
  if (covered < 0) covered = 0;
  return { known: true, days: covered, why: 'replacement walk over ' + rows.length + ' event(s)' };
}

const cases = [];
const tally = { green: 0, pending: 0, candidate: 0, carried: 0, inconclusive: 0 };
// GATE 11 (shared): every clean gate here clears cases on a flag whose BASE RATE
// has never been measured, so the counts each gate fires on are logged - without
// them "this flag discriminates" is an assumption, not a finding.
const gateFires = { g10: 0, g50: 0, g60: 0, g70: 0, g110_full: 0, g110_over: 0, g120: 0, g128_persistent: 0, g128_single: 0, g90: 0, g30: 0,
  g100_overpay_unresolved: 0, g80_split_credited: 0, g80_split_declined: 0 };

for (const item of $input.all()) {
  const c = item.json || {};
  const caseKey = s(c.case_key);
  if (!caseKey) continue;

  const metadata = {
    contract_id: s(c.contract_id), audit_month: auditKey,
    client_id: s(c.client_id), client_name: s(c.client_name),
    maid_id: s(c.maid_id), maid_name: s(c.maid_name),
    contract_status: s(c.contract_status), contract_start: ymd(c.contract_start),
    scheduled_termination: ymd(c.scheduled_termination),
    maid_live_out: c.maid_live_out, cohort_sources: Array.isArray(c.sources) ? c.sources : [],
    enriched: c.needs_enrichment === true
  };

  if (c.skip_computation === true) {
    tally.carried++;
    cases.push({ case_key: caseKey, previous_state: c.previous_state || null, new_state: null,
      carried_state: c.carried_state || null, manual_override_state: c.manual_override_state || null,
      skip_computation: true, reason_code: 'carried_forward',
      reason_text: 'Carried forward from a previous run without re-scoring.',
      finding_reason: '', requires_verifier: false,
      computed: { expected: 0, actual: 0, shortfall: 0, months: {} }, metadata: metadata });
    continue;
  }

  const months = c.months || {};
  const audited = months[auditKey] || null;
  const plan = c.plan || {};

  let state = null, reasonCode = '', reasonText = '', requiresVerifier = false, verifierWhy = '';

  // ---- GATE 10 (Order 10): nothing received is the SIBLING's finding --------
  if (c.received_anything !== true) {
    gateFires.g10++;
    // A CONFLICT BETWEEN GATE 1 AND THE SPEC'S OWN PENDING TEST CASE, resolved
    // the narrow way and flagged for a ruling.
    // Gate 1 says a month with nothing received is the SIBLING's finding and is out
    // of scope here. But the spec's pending test row is 1093404 / August 2026 -
    // "ONE PRE_PDP row of 305 and nothing received" - listed as THIS check's pending
    // case exercising gate 12. Both cannot be true as written.
    // Resolution: a month with nothing received but money IN FLIGHT is reported
    // PENDING here (pending is not a finding, so nothing is double-reported as one);
    // a month with nothing received and nothing in flight stays out of scope and
    // belongs to the sibling. Either way this check never claims the zero-receipt
    // FINDING - that is the sibling's alone.
    const inFlightOnly = audited && audited.in_flight > 0;
    if (inFlightOnly) {
      tally.pending++;
      cases.push({ case_key: caseKey, previous_state: c.previous_state || null,
        new_state: 'pending_flag', carried_state: null,
        manual_override_state: c.manual_override_state || null, skip_computation: false,
        reason_code: 'payment_in_flight',
        reason_text: 'Nothing has been received for ' + auditKey + ' yet, but AED ' + audited.in_flight +
          ' is in flight (PRE_PDP / PDC). Money on its way: neither collected nor a finding. Note gate 1 ' +
          'would put a zero-receipt month out of scope; it is reported here because the spec names this ' +
          'shape as this check\'s pending case, and pending is not a finding so nothing is reported twice.',
        finding_reason: '', requires_verifier: false, gate1_conflict_resolved: true,
        computed: { expected: null, actual: 0, shortfall: null,
          in_flight: audited.in_flight, months: months }, metadata: metadata });
      continue;
    }
    tally.green++;
    cases.push({ case_key: caseKey, previous_state: c.previous_state || null,
      new_state: 'green_flag', carried_state: null,
      manual_override_state: c.manual_override_state || null, skip_computation: false,
      reason_code: 'out_of_scope_nothing_received',
      reason_text: 'Nothing was received for ' + auditKey + '. A month with zero receipts is the ' +
        'CC Non Received Monthly Payments finding, not this one - closed here so the same dirham is ' +
        'never reported twice.',
      finding_reason: '', requires_verifier: false,
      computed: { expected: 0, actual: 0, shortfall: 0, months: months }, metadata: metadata });
    continue;
  }

  // ---- GATE 30: the expectation is the contract's own rate ------------------
  const expectedGross = plan.expected_amount_known === true ? r2(plan.expected_gross) : null;
  if (expectedGross === null) {
    gateFires.g30++;
    requiresVerifier = true;
    verifierWhy = 'currentPayment.amountValue could not be read, so the expected amount is UNKNOWN - ' +
      'never zero and never the price card';
  }

  // ---- GATE 70 then 50: coverage, then pro-rating --------------------------
  const cov = coveredDays(c.replacements, c.replacements_meta, auditKey, rangeStart, rangeEnd,
                          metadata.contract_start);
  const dim = daysInMonth(auditKey);

  if (state === null && cov.known === true && cov.days === 0) {
    gateFires.g70++;
    state = 'green_flag';
    reasonCode = 'no_maid_coverage';
    reasonText = 'No maid was placed for any day of ' + auditKey + ' (' + cov.why + '), so no monthly ' +
      'amount was due. A same-day replacement is not a gap, and the tag date does not answer this.';
  } else if (cov.known === false) {
    requiresVerifier = true;
    verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') + 'maid coverage is unknown (' + cov.why + ')';
  }

  // Expectation, narrowed. Pro-rating applies where the contract STARTED inside the
  // audited month, or where coverage was partial.
  let expected = expectedGross, expectedNote = 'full month at the contract rate';
  let prorated = null;
  if (state === null && expectedGross !== null) {
    const startsThisMonth = metadata.contract_start &&
      metadata.contract_start >= rangeStart && metadata.contract_start <= rangeEnd;
    if (plan.is_one_month_agreement === true) {
      expectedNote = 'one-month agreement (ACC-5712): ERP forces the day-count branch';
    }
    if (startsThisMonth) {
      if (plan.first_month_payment !== null && plan.first_month_payment !== undefined &&
          plan.is_one_month_agreement !== true) {
        expected = r2(plan.first_month_payment);
        expectedNote = 'firstMonthPayment is set, so ERP skips pro-rating entirely';
      } else if (plan.daily_rate_amount && plan.daily_rate_amount > 0 && plan.is_one_month_agreement !== true) {
        const days = dim - Number(metadata.contract_start.slice(8, 10)) + 1;
        expected = r2(days * plan.daily_rate_amount);
        expectedNote = 'a stored dailyRateAmount is used instead of dividing the monthly';
      } else {
        prorated = proRate(expectedGross, metadata.contract_start, auditKey);
        expected = prorated.amount;
        expectedNote = 'pro-rated: ' + prorated.days + ' of ' + prorated.days_in_month + ' days';
      }
    } else if (cov.known === true && cov.days !== null && cov.days > 0 && cov.days < dim) {
      const daily = expectedGross / dim;
      expected = Math.round(cov.days * daily);
      expectedNote = 'pro-rated on coverage: ' + cov.days + ' of ' + dim + ' days served';
    } else if (!metadata.contract_start) {
      requiresVerifier = true;
      verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
        'no startDate on the population row, so pro-rating cannot be ruled in or out';
    }
  }

  // ---- GATE 60: freeze is an OVERLAP test, and it cannot be built today ----
  // ERP stores NO freeze date anywhere: Contract.isCurrentlyFrozen is a single
  // Boolean toggled with no date and no log, and there is no freeze-history entity.
  // A "currently frozen" test gave 4-of-4 false positives (1088698, 1081892,
  // 1094635, 1080333 - the four largest July shortfalls). So this gate CANNOT clear
  // anything, and it must NEVER conclude "not frozen". Gate 128's persistence test
  // is the mitigation: it drops 88% of them using no freeze data at all.
  const freeze = { source: 'unavailable', overlap: null,
    note: 'ERP has no freeze date; a currently-frozen test is a proven 4-of-4 false positive. ' +
          'Gate 60 can neither clear nor exclude - gate 128 mitigates instead.' };

  // ---- GATE 90: refunds other than the four MP-reversing ones -------------
  if (audited && (audited.refund_other > 0 || audited.unrecognised_refund === true)) {
    gateFires.g90++;
    requiresVerifier = true;
    verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
      (audited.unrecognised_refund ? 'an unrecognised refund type is present' :
       'AED ' + audited.refund_other + ' was refunded under a type that does not reverse the monthly ' +
       'payment, so it is annotated and not netted');
  }

  // ---- GATE 80: gap completion, not a blanket sum ------------------------
  // Start from Monthly Payment alone (net of the MP-reversing refunds gate 9
  // nets). Only if that falls short of `expected` do other non-refund RECEIVED
  // types count, and only to the extent they CLOSE THE GAP - money beyond the gap
  // is a separate charge, not this month's fee.
  // Rewritten 2026-08-14 with the spec: the old blanket sum rescued 11 genuine
  // splits and inflated `actual` on 400 contracts whose monthly was already full.
  //
  // THE SPLIT HAS TO LOOK LIKE A SPLIT, not merely be arithmetically possible.
  // Gap-completion as first written would credit ANY non-refund charge that happened
  // to be big enough, which clears a real shortfall on no evidence at all. Measured
  // offline 2026-08-18: monthly 1,000 against expected 5,000 with an unrelated 9,000
  // charge present scored `paid_in_full` GREEN - a 4,000 shortfall in the monthly type
  // manufactured into a clean month by a charge nothing connects to this month's fee.
  //
  // The discriminator is the LEFTOVER. A genuine split collection lands ON the amount
  // owed and leaves nothing over: 1097602 paid 2,252 Monthly Payment + 2,200 Service
  // charge = exactly the 4,452 owed, leftover ZERO, and the client's own WhatsApp says
  // why ("two different cards"). An unrelated charge that merely covers the gap leaves
  // a large remainder, and the spec's own warning applies verbatim - do not trust a
  // type name, a 'Travel To Lebanon Visa' landed on a standard rate by arithmetic
  // coincidence.
  //
  // So: credit the other types only where they close the gap EXACTLY (leftover inside
  // the tolerance). Otherwise `actual` is the Monthly Payment alone and the case takes
  // the normal shortfall path to the verifier, carrying the possible-split annotation.
  // Never a green on an unevidenced split - whether that money was this month's fee is
  // a reading question, which is exactly what gates 130/140 exist to answer.
  function completeGap(m, exp) {
    if (!m) return { actual: 0, monthly: 0, from_other: 0 };
    const monthly = r2(m.monthly_net);
    const other = r2(m.other_received);
    if (exp === null || exp === undefined || monthly >= exp) {
      return { actual: monthly, monthly: monthly, from_other: 0, other_ignored: r2(other) };
    }
    const gap = r2(exp - monthly);
    const used = Math.min(other, gap);
    const leftover = r2(other - used);
    // Closes the gap exactly -> an evidenced-looking split; credit it.
    if (used > 0 && r2(gap - used) <= TOLERANCE && leftover <= TOLERANCE) {
      return { actual: r2(monthly + used), monthly: monthly, from_other: r2(used),
               other_ignored: leftover, split_credited: true };
    }
    // Otherwise the other money is a separate charge until a human says otherwise.
    return { actual: monthly, monthly: monthly, from_other: 0, other_ignored: r2(other),
             split_credited: false,
             split_declined: used > 0
               ? 'AED ' + r2(other) + ' of non-monthly non-refund charges could have covered the AED ' +
                 gap + ' gap, but they leave AED ' + leftover + ' unexplained, so they are NOT credited ' +
                 'as this month\'s fee. A genuine split collection lands on the amount owed exactly.'
               : null };
  }
  const completed = completeGap(audited, expected);
  if (completed.split_credited === true) gateFires.g80_split_credited++;
  if (completed.split_declined) gateFires.g80_split_declined++;
  const actual = completed.actual;
  const inFlight = audited ? r2(audited.in_flight) : 0;

  // ---- GATE 110: the tolerance -------------------------------------------
  const diff = (expected === null) ? null : r2(actual - expected);
  if (state === null && diff !== null) {
    if (Math.abs(diff) <= TOLERANCE) {
      gateFires.g110_full++;
      state = 'green_flag';
      reasonCode = 'paid_in_full';
      reasonText = 'AED ' + actual + ' received against AED ' + expected + ' expected (' + expectedNote +
        '), inside the AED ' + TOLERANCE.toFixed(2) + ' tolerance.';
    } else if (diff > TOLERANCE) {
      gateFires.g110_over++;
      state = 'green_flag';
      reasonCode = 'overpaid';
      reasonText = 'AED ' + actual + ' received against AED ' + expected + ' expected - an overpayment ' +
        'of AED ' + r2(diff) + ', not a shortfall. Recorded so a double payment is visible.';
      // GATE 100 IS ONLY HALF BUILT, AND THIS IS WHERE THAT BITES. Its rule says
      // plainly: never assume the coverage month equals the payment date's month -
      // use paymentDate to place the payment in the PERIOD, and the contract's own
      // billing cycle to decide which month it SETTLES. Upstream keys every month
      // slot on paymentDate alone, because ERP exposes no billing-cycle field this
      // flow has yet found. So a receipt that settles two covered months reads as one
      // fat month, and the month it also covered reads as zero.
      //
      // An overpayment is that shape's signature. Left as a plain green it is a false
      // clearance in BOTH directions: the other covered month goes to the sibling as a
      // non-received finding it does not deserve, and the mirror - next month's fee
      // arriving inside this window - makes a month that was never billed look settled.
      // Measured offline 2026-08-18: 2x the rate with no reversing refund scored a
      // silent green. Double-then-refund is the KNOWN correction pattern and nets to
      // green before reaching here (1055190, and 1047997/1081280/1096224 alike); an
      // overpayment that does NOT net is unresolved, not clean.
      //
      // Green because the money did arrive - this check never reds a payer - but it
      // carries the verifier flag so the covered-month question is actually answered.
      // Same shape the coverage-unknown branch already uses.
      gateFires.g100_overpay_unresolved++;
      requiresVerifier = true;
      verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
        'AED ' + r2(diff) + ' more than one month was received and no monthly-reversing refund nets it, ' +
        'so which covered month(s) this settles is unresolved - gate 100 cannot answer it from paymentDate ' +
        'alone. Confirm whether a later month is already paid before that month is called unpaid.';
    }
  }

  // ---- GATE 120: money in flight -----------------------------------------
  // Applies to the AUDITED month only: every DD-paying contract carries future
  // PRE_PDP / PDC rows, live examples out to 2036.
  if (state === null && diff !== null && diff < -TOLERANCE && inFlight > 0 &&
      r2(actual + inFlight - expected) >= -TOLERANCE) {
    gateFires.g120++;
    state = 'pending_flag';
    reasonCode = 'payment_in_flight';
    reasonText = 'AED ' + inFlight + ' is in flight for ' + auditKey + ', which would cover the AED ' +
      r2(-diff) + ' gap. Money on its way: neither collected nor a finding.';
  }

  // ---- GATE 125: the exception register is INERT on run 1 ----------------
  // Owner's ruling 2026-08-13: run 1 starts from a CLEAN SLATE. The 2025 register
  // is disqualified on its own evidence - 100 of its 311 rows have no approver, no
  // owner, no expiry, constants frozen since 2025 - so reading it in would import
  // the unaudited clearances this run exists to re-establish. It clears NOTHING
  // here, and run 1's REVIEWED output becomes the register runs 2+ clear against.
  const registerCleared = false;

  // ---- GATE 128: persistence ---------------------------------------------
  let persistence = { months_short: 0, months_seen: 0, variance: null, verdict: 'not_evaluated' };
  if (state === null && diff !== null && diff < -TOLERANCE) {
    const shortfalls = [];
    let seen = 0, youngerThanWindow = false;
    for (const w of WINDOWS) {
      const m = months[w.key];
      if (metadata.contract_start && metadata.contract_start > w.to) { youngerThanWindow = true; continue; }
      if (!m) continue;
      seen++;
      // Same contract rate across the window; the audited month's own narrowing
      // (pro-rate, coverage) is not replayed for prior months, so a start-month
      // shortfall does not masquerade as persistent.
      const exp = (metadata.contract_start && metadata.contract_start >= w.from &&
                   metadata.contract_start <= w.to) ? null : expectedGross;
      if (exp === null) continue;
      // The same gap-completion rule per month - a blanket sum here would make a
      // month with a big extra charge look settled and break the persistence read.
      const d = r2(completeGap(m, exp).actual - exp);
      if (d < -TOLERANCE) shortfalls.push(r2(-d));
    }
    const spread = shortfalls.length > 1 ? r2(Math.max.apply(null, shortfalls) - Math.min.apply(null, shortfalls)) : 0;
    persistence = { months_short: shortfalls.length, months_seen: seen, variance: spread,
      younger_than_window: youngerThanWindow, verdict: '' };

    const shortEveryMonth = shortfalls.length >= WINDOWS.length;
    if (shortEveryMonth && spread > TOLERANCE) {
      // Short in EVERY month, but the magnitude moved. Calling that "does not
      // persist" would be wrong - it persists, the rate changed mid-window. Measured
      // on 1054346: short by 1,586 in May and June, then 2,615 in July, because the
      // client was billed 3,129 and then 2,100 against a stored rate of 4,715. That
      // is under-billing that moved, not a one-off, and the verifier needs to know
      // which it is looking at.
      gateFires.g128_persistent++;
      persistence.verdict = 'persistent_varying';
      state = 'red_flag';
      reasonCode = 'shortfall_persistent_varying';
      requiresVerifier = true;
      reasonText = 'Short by AED ' + r2(-diff) + ' against AED ' + expected + ' expected (' +
        expectedNote + '), and short in ALL ' + shortfalls.length + ' months of the window - but the ' +
        'shortfall moved by AED ' + spread + ' across them, so the amount billed changed mid-window ' +
        'rather than being one stable wrong rate.';
      verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
        'the shortfall is present every month but its size changed, which is what a re-billed rate ' +
        'looks like';
    } else if (shortEveryMonth && spread <= TOLERANCE) {
      gateFires.g128_persistent++;
      persistence.verdict = 'persistent';
      state = 'red_flag';                       // PROVISIONAL - see gate 130
      reasonCode = 'shortfall_persistent';
      requiresVerifier = true;
      reasonText = 'Short by AED ' + r2(-diff) + ' against AED ' + expected + ' expected (' +
        expectedNote + '), and short in all ' + shortfalls.length + ' months of the window with a ' +
        'variance of AED ' + spread + '. A wrong rate persists; a light month does not.';
      verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
        'the shortfall is stable across the window, so it looks like a rate rather than a one-off';
    } else {
      gateFires.g128_single++;
      persistence.verdict = youngerThanWindow ? 'younger_than_window'
        : (shortfalls.length <= 1 ? 'single_month' : 'unstable');
      state = 'red_flag';                       // PROVISIONAL - see gate 130
      reasonCode = 'shortfall_unstable';
      requiresVerifier = true;
      reasonText = 'Short by AED ' + r2(-diff) + ' against AED ' + expected + ' expected (' +
        expectedNote + '), but the shortfall is ' + persistence.verdict.replace(/_/g, ' ') +
        ' across the window' + (spread ? ' (variance AED ' + spread + ')' : '') +
        '. A temporary dip - a freeze, a light month - looks exactly like this, and ERP stores no ' +
        'freeze date to rule it out.';
      verifierWhy = (verifierWhy ? verifierWhy + '; and ' : '') +
        'the shortfall does not persist, which is what a freeze or a one-off looks like';
    }
  }

  // ---- GATE 130: nothing becomes a finding without the quoted amount ------
  // EVERY candidate leaves here as a provisional red that REQUIRES the verifier.
  // The rate on file is not reliably the rate billed, so "actual < expected" is a
  // candidate and nothing more. Rules 14/15/16 decide, on the message evidence.
  if (state === 'red_flag') {
    requiresVerifier = true;
    tally.candidate++;
  } else if (state === 'green_flag') {
    tally.green++;
  } else if (state === 'pending_flag') {
    tally.pending++;
  } else {
    // Unreachable in principle: a case with a readable expectation lands on one of
    // the branches above. Fail visibly rather than publishing a stateless case.
    state = 'red_flag';
    reasonCode = 'unscored';
    requiresVerifier = true;
    reasonText = 'This case reached the end of the gates without a verdict. Treat it as a scorer defect, ' +
      'not a finding.';
    tally.candidate++;
  }
  if (requiresVerifier) tally.inconclusive++;

  cases.push({
    case_key: caseKey,
    previous_state: c.previous_state || null,
    new_state: state,
    carried_state: null,
    manual_override_state: c.manual_override_state || null,
    skip_computation: false,
    reason_code: reasonCode,
    reason_text: reasonText,
    // The portal must carry the two finding reasons SEPARATELY - `client underpaid`
    // and `under-billed` need different follow-up from different teams even though
    // they carry the same money. The scorer cannot tell them apart: only the quoted
    // amount can, so this stays empty until the verifier fills it.
    finding_reason: '',
    requires_verifier: requiresVerifier,
    verifier_reason: verifierWhy,
    register_cleared: registerCleared,
    computed: {
      expected: expected,
      expected_gross: expectedGross,
      expected_known: expectedGross !== null,
      expected_note: expectedNote,
      prorated: prorated,
      actual: actual,
      actual_from_monthly: completed.monthly,
      actual_from_other_types_closing_the_gap: completed.from_other,
      other_types_ignored_as_separate_charges: completed.other_ignored === undefined ? 0 : completed.other_ignored,
      split_credited: completed.split_credited === true,
      split_declined: completed.split_declined || null,
      shortfall: diff === null ? null : (diff < 0 ? r2(-diff) : 0),
      variance: diff,
      in_flight: inFlight,
      tolerance: TOLERANCE,
      months: months,
      persistence: persistence,
      coverage: cov,
      freeze: freeze,
      basis: 'VAT-inclusive; agreed x 1.05 matches 0 of 5,612 contracts, so VAT is never added'
    },
    metadata: Object.assign(metadata, {
      refund_mp_reversing: audited ? audited.refund_mp_reversing : 0,
      refund_other: audited ? audited.refund_other : 0,
      unrecognised_refund: audited ? audited.unrecognised_refund === true : false,
      types_seen: audited ? audited.types_seen : {},
      dead_rows: audited ? audited.dead_rows : 0,
      bulk_only_rows: audited ? audited.bulk_only_rows : 0,
      discount_text: [s(plan.additional_discount && plan.additional_discount.text),
                      s(plan.credit_note_discount && plan.credit_note_discount.text)]
                     .filter(function (t) { return !!t.trim(); }),
      gate4_departure: plan.gate4_departure || null,
      snowflake_item_discount: s(plan.snowflake_item_discount),
      rate_is_contractual_not_billed: true,
      stale_rule_constant: STALE_RULE_CONSTANT_NOTE
    })
  });
}

const scored = cases.filter(function (k) { return !k.skip_computation; }).length;
console.log(JSON.stringify({ stage: 'compute_case_states', cases: cases.length, scored: scored,
  green: tally.green, pending: tally.pending, candidates_requiring_verifier: tally.candidate,
  carried: tally.carried, gate_fires: gateFires,
  note: 'NO RED IS FINAL HERE. Every candidate requires gate 130 and the verifier: the rate on file ' +
        'is the contractual rate and is not reliably the amount billed.' }));

// The measured funnel for July 2026: 5,612 CC contracts paid, 4,575 exact, 984
// short. Run 1 is EXPECTED to be big - 108 contracts are stably under-billed,
// ~AED 64,000/month - so there is no tripwire on the candidate count here. What
// would be wrong is reporting 984 findings: the residue bounds are 1 strict to ~40
// lenient, and the rest are candidates awaiting the quoted-amount read.
return [{ json: { cases: cases } }];
