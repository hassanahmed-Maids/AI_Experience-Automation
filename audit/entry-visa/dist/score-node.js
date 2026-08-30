// ===================== ENTRY VISA AUDIT — DETERMINISTIC SCORER =====================
// GENERATED — do not edit here. Canonical source: audit/entry-visa/scorer.js
// Re-generate with: node audit/entry-visa/build-node.js
//
// Edited in the n8n UI, this node silently stops matching the 23 offline tests that are
// the only proof it is correct. Change scorer.js, re-run the tests, re-generate.
//
// Pure: no I/O, no ERP, no clock of its own. The run date arrives on the input so a run
// is reproducible — scoring the same population twice must give the same answer, and a
// gate that read Date.now() directly would quietly stop doing that.

/**
 * Entry Visa Audit — the deterministic scorer.
 *
 * Implements the 15 deterministic gates of the Audit Conditional Policy — Both Maids,
 * in Order, at the TWO case grains rule 3 requires. Pure: no I/O, no ERP, no clock of
 * its own. That is deliberate — it is the fixed reference the n8n flow is checked
 * against, so if a later refactor changes these numbers, the refactor is wrong.
 *
 * Spec: Notion "Entry Visa Audit" v0.7 (2026-08-28).
 * Rules: Audit Conditional Policy — Both Maids  (NOT the CC Maid database the check
 *        page links to — see SPEC-CORRECTIONS.md).
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING TO UNDERSTAND BEFORE READING ANY GATE
 * ---------------------------------------------------------------------------
 * This is not one check. It is two, running in parallel over the same charges:
 *
 *   CHARGE GRAIN  (gates 5-12)  one case per entry-visa charge, on requests that
 *                               were EVER rejected. 1,095 charges measured.
 *   PAIR GRAIN    (gates 13,14) one case per charge PAIR. Gate 13 runs on EVERY
 *                               entry-visa charge, rejected or not; gate 14 runs on
 *                               the refund-family scope.
 *
 * A single charge can carry a verdict in each. Ordering gates 13 and 14 as ordinary
 * charge-grain gates makes them dead code for 100% of their own cases (AED 46,626),
 * because gates 5-8 settle every charge first. Their Order values of 130 and 140 are
 * REPORTING positions, not queue positions.
 */

// ---------------------------------------------------------------------------
// Constants. Every one of these is a measured figure with a stated provenance;
// none may be adjusted to make a number come out.
// ---------------------------------------------------------------------------

/** Gate 6 / gate 9. Days from rejection within which the refund must be claimed. */
const REFUND_WINDOW_DAYS = 60;

/**
 * Gate 10. The refundable constants. THE MAPPING FROM CHARGE TYPE TO CONSTANT IS
 * NOT ESTABLISHED — measured over 866 charge-refund pairs, purpose predicts the
 * constant only ~94% of the time and the amount band only ~95%. Every value this
 * scorer produces is therefore a LOWER BOUND, and says so in the output.
 */
const REFUNDABLE_HIGH = 739.50;   // the ENTRY_VSIA / '> 1000 AED' application
const REFUNDABLE_LOW  = 89.50;    // the ENTRY_VISA_LESS_THAN_1000 / '< 1000 AED' one
const AMOUNT_BAND_BOUNDARY = 1000;

/**
 * A third refund value exists on exactly one request. The claim "only 89.50 and
 * 739.50 occur" was withdrawn on 2026-08-20, so it is listed here rather than
 * treated as an anomaly — but see refundIsRecognised(): an unrecognised amount does
 * NOT clear a case.
 */
const KNOWN_REFUND_AMOUNTS = [REFUNDABLE_LOW, REFUNDABLE_HIGH, 125.65];

/**
 * Gate 6. Booking skew: a refund dated slightly BEFORE its rejection is a booking
 * artefact and still clears the charge. Measured: of 62 requests whose only refund
 * pre-dates the rejection, 11 are within 7 days; the other 51 are 11-462 days
 * earlier and belong to a PREVIOUS cycle. Anything past this tolerance must not
 * clear the current one.
 */
const BOOKING_SKEW_TOLERANCE_DAYS = 7;

/**
 * Gate 1. The rejection history only carries the current vocabulary from this date.
 * An earlier window has no dated rejections at all and returns a SILENTLY EMPTY
 * population — which reads as a clean month rather than as a broken run.
 */
const EARLIEST_SUPPORTED_DATE = '2025-09-05';

/**
 * The ERP API's own purpose labels. These are HUMAN LABELS. The warehouse view uses
 * enum names for the identical field ('ENTRY_VSIA', 'ENTRY_VISA_LESS_THAN_1000',
 * 'REFUND_FOR_ENTRY_VISA') and the two vocabularies DO NOT OVERLAP — a filter
 * written for one returns zero rows against the other.
 *
 * Both vocabularies are accepted here, because the population list is a warehouse
 * read today (open ruling 7) while the per-request detail is an ERP read, so one
 * scorer sees both. Which vocabulary a row arrived in is recorded on the case.
 */
const CHARGE_PURPOSES = {
  HIGH: ['Entry Visa > 1000 AED', 'ENTRY_VSIA'],
  LOW:  ['Entry Visa < 1000 AED', 'ENTRY_VISA_LESS_THAN_1000']
};
const REFUND_PURPOSES = ['Refund For Entry Visa', 'REFUND_FOR_ENTRY_VISA'];

/**
 * NOT a refund for this check. It sits in the SAME expenses[] array, has 1,335 Added
 * rows, and belongs to the Medical from Visa Expenses check whose window is 90 days,
 * not 60. A contains('REFUND') filter pulls it in and silently clears real findings.
 */
const FOREIGN_REFUND_PURPOSES = ['Refund Medical Application Fees', 'REFUND_MEDICAL_APPLICATION_FEES'];

const EXPENSE_STATUS = { ADDED: 'Added', PENDING: 'Pending', DISMISSED: 'Dismissed' };

/** The ONLY value of entryVisaImmigrationApproved that means a rejection happened. */
const REJECTED = 'Rejected';

/**
 * Gate 7 / gate 8. 'Finished' is not a field — there is no requestStatus on this
 * payload; it returns null on every request, and its ONGOING/STOPPED/COMPLETED
 * vocabulary belongs to the warehouse view. Finished is a COMBINATION.
 */
const TASK_COMPLETE = 'Visa processing complete';

const VERDICT = {
  FINDING: 'finding',
  CLEAN: 'clean',
  PENDING: 'pending',
  VERIFIER: 'route to verifier'
};

// ---------------------------------------------------------------------------
// Small helpers. Dates are compared as instants; all ERP timestamps are Dubai local
// and no cross-zone arithmetic happens here.
// ---------------------------------------------------------------------------

function toTime(d) {
  if (d === null || d === undefined || d === '') return null;
  const t = (d instanceof Date) ? d.getTime() : Date.parse(String(d).replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

function daysBetween(fromTime, toTimeMs) {
  return (toTimeMs - fromTime) / 86400000;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function purposeClass(purpose) {
  const p = String(purpose === null || purpose === undefined ? '' : purpose).trim();
  if (CHARGE_PURPOSES.HIGH.indexOf(p) !== -1) return 'HIGH';
  if (CHARGE_PURPOSES.LOW.indexOf(p) !== -1) return 'LOW';
  return null;
}

function isEntryVisaCharge(line) {
  return purposeClass(line && line.purpose) !== null;
}

function isEntryVisaRefund(line) {
  const p = String((line && line.purpose) || '').trim();
  // Checked before the positive test, because REFUND_MEDICAL_APPLICATION_FEES would
  // otherwise be caught by any loosening of the list below.
  if (FOREIGN_REFUND_PURPOSES.indexOf(p) !== -1) return false;
  return REFUND_PURPOSES.indexOf(p) !== -1;
}

/**
 * Gate 4. NEVER decide a line is a refund by its SIGN. REFUND_FOR_ENTRY_VISA on the
 * new-request side ranges from -1,022.50 to +739.50; only the purpose is reliable.
 * So amounts are compared in absolute terms wherever a magnitude is meant.
 */
function refundMagnitude(line) {
  const a = num(line && line.amount);
  return a === null ? null : Math.abs(a);
}

function refundIsRecognised(line) {
  const m = refundMagnitude(line);
  if (m === null) return false;
  return KNOWN_REFUND_AMOUNTS.some(function (k) { return Math.abs(k - m) < 0.005; });
}

// ---------------------------------------------------------------------------
// GATE 1 — population, and the two scopes.
// ---------------------------------------------------------------------------

/**
 * A charge is IN the refund-family population when it is an entry-visa charge, it is
 * Added, it has a transaction behind it, and its request carries at least one
 * Rejected event IN ITS HISTORY.
 *
 * Never read the CURRENT value of the rejection flag as the population test. Rejected
 * is transient: 694 requests were ever rejected while only 487 read Rejected today, so
 * a snapshot filter drops 30% of the population — and it drops precisely the requests
 * that recovered after a rejection, which is where a forgotten refund hides.
 *
 * Never treat Added as proof money moved: 1,995 Added charge lines carry no
 * transaction id. The transaction id is the test.
 */
function chargeIsPaid(line) {
  return String(line && line.status) === EXPENSE_STATUS.ADDED &&
         line.transactionId !== null && line.transactionId !== undefined && line.transactionId !== '';
}

/**
 * Gate 1's red note: requiring Added + a transaction id makes PENDING charges
 * invisible, and that manufactured a fake case for gate 12 (request 115431 read as a
 * refund with no charge behind it, when the charge was there at status Pending).
 * Pending charges are therefore counted into the population AS A DISTINCT STATE —
 * they are not scored as paid, but they are visible, so gate 12 can tell a genuine
 * orphan from an artefact of this line.
 */
function chargeIsPendingUnpaid(line) {
  return String(line && line.status) === EXPENSE_STATUS.PENDING;
}

// ---------------------------------------------------------------------------
// GATE 3 — the charge cycle. This is the decision that sets the check's size:
// the three plausible readings give 36, 93 and 223 findings on identical data.
// ---------------------------------------------------------------------------

/**
 * The rejection that ended THIS charge's application: the first Rejected event dated
 * at or after the charge, and BEFORE the next entry-visa charge on the same request.
 *
 * Never pair a charge with an unbounded later rejection. Requests carry 4.5 rejection
 * events on average, and one measured charge of 2025-08-05 has its nearest later
 * rejection on 2026-06-23 — 322 days and at least one intervening cycle away.
 */
function rejectionForCharge(chargeTime, nextChargeTime, rejectionTimes) {
  for (let i = 0; i < rejectionTimes.length; i++) {
    const r = rejectionTimes[i];
    if (r < chargeTime) continue;
    if (nextChargeTime !== null && r >= nextChargeTime) break;
    return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The scorer.
// ---------------------------------------------------------------------------

/**
 * @param {Object} input
 * @param {Array}  input.requests  one entry per visa request, already assembled:
 *   {
 *     requestId, ownerId, ownerType, stopped, taskName,
 *     rejectionDates: [ISO...],       // from taskHistorys[] / history, NOT today's status
 *     expenses: [ { id, purpose, status, amount, transactionId, transactionDate,
 *                   paymentDate, requestType } ],
 *     cancelSideRefunds: [ ...same shape... ],  // gate 4: mapped across already
 *     identityAgrees: true|false|null,          // gate 2
 *     everRejectedKnown: true                   // false when the history could not be read
 *   }
 * @param {Object} [opts]
 * @param {string} [opts.asOf]  the run date, for the elapsed-days report on gate 7.
 */
function score(input, opts) {
  const options = opts || {};
  const asOfTime = toTime(options.asOf) || Date.now();
  const requests = Array.isArray(input && input.requests) ? input.requests : [];

  const chargeCases = [];
  const pairCases = [];
  const declaredGaps = [];

  // A charge index across ALL requests, for gate 13's wider, cross-request,
  // same-OWNER scope. Gate 13 is per person, not per request.
  const chargesByOwner = new Map();

  for (let ri = 0; ri < requests.length; ri++) {
    const req = requests[ri];
    const expenses = Array.isArray(req.expenses) ? req.expenses : [];

    // ---- assemble this request's charges, in date order -------------------
    const charges = expenses
      .filter(isEntryVisaCharge)
      .map(function (line) {
        return {
          line: line,
          requestId: req.requestId,
          ownerId: req.ownerId,
          ownerType: req.ownerType,
          purposeClass: purposeClass(line.purpose),
          purposeRaw: String(line.purpose),
          amount: num(line.amount),
          paid: chargeIsPaid(line),
          pendingUnpaid: chargeIsPendingUnpaid(line),
          // transactionDate is the ONLY usable clock. paymentDate on the expense line
          // is NULL on 85.7% of charge rows; a 60-day rule clocked off it drops six of
          // every seven cases AND THE SURVIVORS STILL RECONCILE, so nothing looks wrong.
          time: toTime(line.transactionDate)
        };
      })
      .sort(function (a, b) {
        if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
        return Number(a.line.id || 0) - Number(b.line.id || 0);
      });

    // ---- gate 4: the refund set, BOTH channels ---------------------------
    // Assembled before any gate tests whether a refund is missing, because this rule
    // narrows the expectation and must run ahead of every gap test.
    //
    // Never join refunds only on the new-request id: 243 refund lines hang off the
    // CANCELLATION request, and skipping them raises 243 findings against money we
    // actually got back.
    const cancelSide = Array.isArray(req.cancelSideRefunds) ? req.cancelSideRefunds : [];
    const allRefundLines = expenses.filter(isEntryVisaRefund)
      .map(function (l) { return { line: l, channel: 'NewRequest' }; })
      .concat(cancelSide.filter(isEntryVisaRefund)
        .map(function (l) { return { line: l, channel: 'CancelRequest' }; }));

    // Only Added lines are money received. Pending and Dismissed are NOT exclusions —
    // they are two distinct finding shapes with two different owners, so they are kept
    // and classified rather than dropped.
    const refundsReceived = allRefundLines
      .filter(function (r) { return String(r.line.status) === EXPENSE_STATUS.ADDED; })
      .map(function (r) {
        return {
          line: r.line, channel: r.channel,
          magnitude: refundMagnitude(r.line),
          recognised: refundIsRecognised(r.line),
          time: toTime(r.line.transactionDate)
        };
      });
    const refundsPending   = allRefundLines.filter(function (r) { return String(r.line.status) === EXPENSE_STATUS.PENDING; });
    const refundsDismissed = allRefundLines.filter(function (r) { return String(r.line.status) === EXPENSE_STATUS.DISMISSED; });

    const rejectionTimes = (Array.isArray(req.rejectionDates) ? req.rejectionDates : [])
      .map(toTime).filter(function (t) { return t !== null; }).sort(function (a, b) { return a - b; });

    const paidCharges = charges.filter(function (c) { return c.paid; });

    // GATE 1's TWO SCOPES, enforced here and nowhere else.
    //
    // The REFUND FAMILY (gates 5-12, 14) runs only on charges whose request carries at
    // least one Rejected event in its HISTORY. The DUPLICATE FAMILY (gate 13) runs on
    // every entry-visa charge with a transaction, rejected or not — a duplicate payment
    // has nothing to do with a rejection, and scoping it behind one hid 134 of 176
    // duplicate-shaped pairs worth AED 92,247.32.
    //
    // Without this line a never-rejected request's charges fall through to gate 5 and
    // are scored 'clean'. The verdict would be harmless; the POPULATION COUNT would not
    // be — it is the number the runs log publishes so a silently empty month is
    // visible, and inflating it from 1,095 to every entry-visa charge ever raised
    // destroys exactly that signal.
    const inRefundFamily = rejectionTimes.length > 0;

    // ---- GATE 12 — a refund with no entry-visa charge behind it ----------
    // Its population may be ENTIRELY an artefact of gate 1's filter, so the Pending
    // charges gate 1 now counts are checked here before anything is called an orphan.
    if (rejectionTimes.length > 0 && refundsReceived.length > 0 && paidCharges.length === 0) {
      const pendingCharges = charges.filter(function (c) { return c.pendingUnpaid; });
      chargeCases.push(makeCase({
        req: req, charge: null, gate: 12, order: 120, verdict: VERDICT.VERIFIER,
        verdictName: 'Needs investigation — orphan refund',
        why: pendingCharges.length > 0
          ? 'A refund was Added against a charge that exists but was NEVER PAID (status Pending). ' +
            'That is not "a refund with no charge" — money came back on a fee we had not yet incurred. ' +
            'Stranger than the rule anticipated, and still a human question.'
          : 'A refund was received on this request and no entry-visa charge with a transaction exists on it. ' +
            'Never scored clean (money moved back with nothing recorded as moving out) and never scored as a ' +
            'finding either (this check measures unrecovered spend; an unexplained recovery is a different ' +
            'question with a different owner).',
        recoverable: null,
        evidence: {
          refunds_received: refundsReceived.length,
          charges_pending_unpaid: pendingCharges.length,
          charges_total: charges.length
        }
      }));
    }

    // ---- CHARGE GRAIN: gates 2, 5-11 ------------------------------------
    for (let ci = 0; ci < paidCharges.length; ci++) {
      const c = paidCharges[ci];

      // index for gate 13's cross-request scope — populated for EVERY paid charge,
      // including those outside the refund family, because gate 13's scope is wider.
      const key = String(c.ownerId);
      if (!chargesByOwner.has(key)) chargesByOwner.set(key, []);
      chargesByOwner.get(key).push({
        charge: c, req: req,
        rejectionTimes: rejectionTimes,
        refundsAddedTimes: refundsReceived.map(function (r) { return r.time; }).filter(function (t) { return t !== null; })
      });

      // The next entry-visa charge on this request bounds the cycle (gate 3).
      const nextPaid = paidCharges[ci + 1];
      const nextChargeTime = nextPaid ? nextPaid.time : null;

      // Everything below this line is the REFUND FAMILY and is skipped for a request
      // that was never rejected. Gate 13 has already indexed the charge above.
      if (!inRefundFamily) continue;

      // GATE 2 — identity, at Order 20, BEFORE any gate reads a status or an amount.
      // Never fall back to matching by person name: the prior manual run did, and its
      // own cross-check then confirmed 0 of 41. One live name resolves to two maids.
      if (req.identityAgrees === false || c.ownerId === null || c.ownerId === undefined || c.ownerId === '') {
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 2, order: 20, verdict: VERDICT.VERIFIER,
          verdictName: 'Needs investigation — identity',
          why: "The structured owner id did not resolve, or disagreed with the person the charge's own " +
               'transaction names. A charge we cannot attribute is still money we spent — dropping it is a ' +
               'false clearance, routing it costs someone ten minutes.',
          recoverable: null,
          evidence: { identity_agrees: req.identityAgrees === null ? 'unknown' : req.identityAgrees }
        }));
        continue;
      }

      // If the rejection history could not be read at all, the charge cannot be
      // cycled. It does NOT fall through to clean — it goes to the verifier, and the
      // verifier may not manufacture the date (verifier rule 1).
      if (req.everRejectedKnown === false) {
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 15, order: 150, verdict: VERDICT.PENDING,
          verdictName: 'Unsettled — rejection history unreadable',
          why: 'The rejection history could not be read for this request, so no gate can pair this charge ' +
               'with a rejection. Silence is pending, never clean.',
          recoverable: null, evidence: { last_gate_passed: 3 }
        }));
        continue;
      }

      const rejTime = c.time === null ? null : rejectionForCharge(c.time, nextChargeTime, rejectionTimes);

      // GATE 5 — no rejection in this cycle: the application that worked.
      // Never read this as "the request is healthy". It clears ONE charge, not the
      // request — 64 of the findings sit on requests that completed successfully.
      if (rejTime === null) {
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 5, order: 50, verdict: VERDICT.CLEAN,
          verdictName: 'Application succeeded, no refund due',
          why: 'No rejection event falls at or after this charge and before the next charge on the same ' +
               'request, so this is the application that worked and no refund was owed.',
          recoverable: 0, evidence: { rejection_events_on_request: rejectionTimes.length }
        }));
        continue;
      }

      // The refunds that could possibly answer THIS rejection.
      const candidates = refundsReceived.filter(function (r) {
        if (r.time === null) return false;
        const d = daysBetween(rejTime, r.time);
        // A refund dated before the rejection clears it only inside the booking-skew
        // tolerance; beyond that it belongs to a previous cycle (51 of 62 measured).
        if (d < 0) return Math.abs(d) <= BOOKING_SKEW_TOLERANCE_DAYS;
        return true;
      });
      const inWindow = candidates.filter(function (r) {
        return daysBetween(rejTime, r.time) <= REFUND_WINDOW_DAYS;
      });
      const late = candidates.filter(function (r) {
        return daysBetween(rejTime, r.time) > REFUND_WINDOW_DAYS;
      });

      // GATE 11 — short refund. DECLARED DEVIATION, see SPEC-CORRECTIONS.md.
      // The rule is marked BLOCKED, DO NOT EVALUATE: which constant applies per charge
      // cycle is not established. But leaving it silent means a refund of an
      // unrecognised amount falls through gate 6 and reads as FULLY CLEAN — the exact
      // false clearance the rule exists to prevent. So: a refund inside the window
      // whose amount is not one of the three known values does not clear the case, it
      // routes. It is never scored AS a shortfall, because that conclusion is blocked.
      const unrecognisedInWindow = inWindow.filter(function (r) { return !r.recognised; });
      if (inWindow.length > 0 && unrecognisedInWindow.length === inWindow.length) {
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 11, order: 110, verdict: VERDICT.VERIFIER,
          verdictName: 'Needs investigation — refund amount not a known constant',
          why: 'A refund landed inside the window but its amount is none of the three values ever observed. ' +
               'Gate 11 is BLOCKED from concluding a shortfall (which constant applies per charge cycle is ' +
               'not established), and clearing it at gate 6 would be a false clearance. So it routes.',
          recoverable: null,
          evidence: { refunds_in_window: inWindow.length, all_unrecognised: true }
        }));
        continue;
      }

      // GATE 6 — refunded in time. 49% of charges resolve here. Measured lag: min 0
      // days, median 1, max 30 — the refund is filed by an RPA and is normally same-day.
      if (inWindow.length > 0) {
        const best = inWindow.reduce(function (a, b) { return a.time <= b.time ? a : b; });
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 6, order: 60, verdict: VERDICT.CLEAN,
          verdictName: 'Refunded in time',
          why: 'A mapped refund was received within ' + REFUND_WINDOW_DAYS + ' days of the rejection.',
          recoverable: 0,
          evidence: {
            lag_days: Math.round(daysBetween(rejTime, best.time) * 10) / 10,
            channel: best.channel
          }
        }));
        continue;
      }

      // GATE 9 — claimed late. ZERO cases in 11.5 months; max observed lag is 30 days.
      // Shipped as an explicitly untested path (open ruling 3).
      if (late.length > 0) {
        const first = late.reduce(function (a, b) { return a.time <= b.time ? a : b; });
        chargeCases.push(makeCase({
          req: req, charge: c, gate: 9, order: 90, verdict: VERDICT.FINDING,
          verdictName: 'Lost refund — claimed late',
          why: 'A mapped refund exists but its transaction date is more than ' + REFUND_WINDOW_DAYS +
               ' days after the rejection.',
          recoverable: valueFinding(c).value,
          valuationBasis: valueFinding(c).basis,
          untestedPath: true,
          evidence: { lag_days: Math.round(daysBetween(rejTime, first.time) * 10) / 10, channel: first.channel }
        }));
        continue;
      }

      // No refund received. Gates 7 and 8 split on whether the process is over.
      // 'Finished' is stopped=false AND taskName='Visa processing complete'.
      // 'Abandoned' is stopped=true. Anything else is still running.
      const stopped = req.stopped === true;
      const finished = req.stopped === false && String(req.taskName || '') === TASK_COMPLETE;
      const processOver = stopped || finished;

      if (processOver) {
        // Which of the THREE finding shapes? They have three different owners and the
        // recoverable money hides inside the unrecoverable if they are merged.
        let shape, shapeVerdict = VERDICT.FINDING, shapeName;
        if (refundsPending.length > 0) {
          shape = 'claimed_never_paid';
          shapeName = 'Lost refund — never claimed (claim filed, money stuck at Pending)';
        } else if (refundsDismissed.length > 0) {
          shape = 'claim_dismissed';
          shapeName = 'Needs investigation — refund claim was withdrawn';
          // The largest of the three shapes and the one nobody had named. Either the
          // refund was genuinely not due or a valid claim was cancelled; only a human
          // can tell, so it routes rather than scoring.
          shapeVerdict = VERDICT.VERIFIER;
        } else {
          shape = 'never_filed';
          shapeName = 'Lost refund — never claimed (no refund line was ever created)';
        }

        const val = valueFinding(c);
        const elapsed = Math.round(daysBetween(rejTime, asOfTime) * 10) / 10;

        // THE KNOWN DEFECT, implemented as the spec directs and reported rather than
        // silently patched. Gate 7 has NO minimum-elapsed guard, so a request abandoned
        // one day after rejection reds instantly, before anyone could reasonably have
        // claimed the refund. Test case 3 (request 114521) is exactly this: abandoned
        // WHILE SITTING IN the refund step, 27 days elapsed. The spec's own expected
        // verdict was corrected to 'finding' and the gap logged as a defect for the
        // owner. So it reds — and the case carries the flag, and the run summary
        // carries the count, so the inflation is visible instead of absorbed.
        const prematureByAbandonment = stopped && !finished && elapsed < REFUND_WINDOW_DAYS;

        chargeCases.push(makeCase({
          req: req, charge: c, gate: 7, order: 70,
          verdict: shapeVerdict, verdictName: shapeName,
          why: 'The application was rejected, no refund line with status Added exists after that rejection, ' +
               'and the request is ' + (stopped ? 'abandoned' : 'finished') + '. A closed request will never ' +
               'receive a refund.',
          recoverable: shapeVerdict === VERDICT.FINDING ? val.value : null,
          valuationBasis: val.basis,
          evidence: {
            finding_shape: shape,
            request_state: stopped ? 'abandoned (stopped=true)' : 'finished (stopped=false + task complete)',
            elapsed_days_since_rejection: elapsed,
            refund_lines_pending: refundsPending.length,
            refund_lines_dismissed: refundsDismissed.length,
            // Never gate on refundedStatus: on request 91412 it reads true while the
            // refund line is still Pending and unpaid 297 days later. It tracks whether
            // the WORKFLOW STEP completed, not whether we were repaid.
            refundedStatus_deliberately_ignored: true,
            premature_by_abandonment: prematureByAbandonment
          },
          defect: prematureByAbandonment ? 'GATE-7-NO-MINIMUM-ELAPSED-GUARD' : null
        }));
        continue;
      }

      // GATE 8 — still running, so a refund may yet arrive. This is also where the
      // DEFAULT lands: an unreadable 'stopped' reads as false without the completion
      // task name, so the case parks here instead of reddening at gate 7. That is the
      // conservative direction and it is deliberate.
      chargeCases.push(makeCase({
        req: req, charge: c, gate: 8, order: 80, verdict: VERDICT.PENDING,
        verdictName: 'Still inside the window',
        why: 'The application was rejected and no refund has arrived yet, but the request is still running, ' +
             'so a refund may still be in flight. Never call an open request clean — pending and clean are ' +
             'different states and only pending gets looked at again.',
        recoverable: null,
        evidence: {
          elapsed_days_since_rejection: Math.round(daysBetween(rejTime, asOfTime) * 10) / 10,
          stopped_readable: req.stopped === true || req.stopped === false
        }
      }));
    }

    // ---- PAIR GRAIN, gate 14 — wrong entry-visa type ---------------------
    // Refund-family scope: it needs a rejection between the two charges. Its Order of
    // 140 is a REPORTING position — every one of its 50 measured pairs has a rejection
    // after the first charge, so as a charge-grain gate 6 or 7 would settle it first
    // and this rule would never fire.
    for (let i = 0; i < paidCharges.length - 1; i++) {
      const a = paidCharges[i], b = paidCharges[i + 1];
      if (a.purposeClass === null || b.purposeClass === null) continue;
      if (a.purposeClass === b.purposeClass) continue;       // no type switch
      if (a.time === null || b.time === null) continue;
      const between = rejectionTimes.filter(function (t) { return t >= a.time && t < b.time; });
      // Never read a type switch WITHOUT a rejection between the charges as this
      // finding. 22 such pairs exist and they are gate 13's duplicates, not wrong-type
      // submissions — confusingly they carry the same money, seen from another angle.
      if (between.length === 0) continue;

      // VALUATION. Never at the refundable constant — the waste here is the cycle, not
      // the unrecovered refund on it. But the figure depends on whether the wrongly
      // typed first charge was itself refunded:
      //
      //   refunded     -> the loss is only the NON-REFUNDABLE REMAINDER (charge - refund).
      //                   Request 92147: 1,022.50 - 739.50 = AED 283.00, which is exactly
      //                   Khalil SOP section 5.2's "≈283 lost".
      //   not refunded -> the whole first charge was wasted.
      //
      // This is where ruling 1 bites: that remainder appears IDENTICALLY on correctly
      // typed applications (17 outside and 9 inside rows at exactly 286.15), so on a
      // correctly typed application it is an unavoidable government cost, and only on a
      // WRONG-typed one is it an avoidable loss. Gate 14 firing is what makes it a loss
      // — so this figure is reported, and flagged as depending on that open ruling.
      const rejTimeForPair = between[0];
      const clearingRefund = refundsReceived.filter(function (r) {
        if (r.time === null) return false;
        const d = daysBetween(rejTimeForPair, r.time);
        if (d < 0) return Math.abs(d) <= BOOKING_SKEW_TOLERANCE_DAYS;
        return d <= REFUND_WINDOW_DAYS;
      }).sort(function (x, y) { return x.time - y.time; })[0] || null;

      const firstWasRefunded = clearingRefund !== null && clearingRefund.magnitude !== null;
      const wasted = (a.amount === null) ? null
        : (firstWasRefunded ? Math.round((a.amount - clearingRefund.magnitude) * 100) / 100 : a.amount);

      pairCases.push({
        grain: 'pair',
        gate: 14, order: 140,
        requestId: req.requestId, ownerId: req.ownerId,
        verdict: VERDICT.FINDING,
        verdictName: 'Wrong entry-visa type submitted',
        why: 'The same request carries two entry-visa charges of DIFFERENT types with a rejection between ' +
             'them: we submitted one type, immigration rejected it, and we then submitted the other. That is ' +
             "the system's own admission that the first type was wrong — a stronger witness than a location " +
             'field would be, because a different process wrote it.',
        wasted: wasted,
        valuationBasis: firstWasRefunded
          ? 'non-refundable remainder of the wrongly typed first charge (it WAS refunded) — ' +
            'counts as a loss only if owner ruling 1 says the remainder is a loss on a wrong-typed application'
          : 'the whole first charge (it was never refunded, so the entire cycle was wasted)',
        dependsOnOpenRuling: firstWasRefunded ? 'ruling 1 — is the non-refundable remainder a loss?' : null,
        evidence: {
          direction: a.purposeClass === 'HIGH' ? 'inside -> rejected -> outside' : 'outside -> rejected -> inside',
          first_charge_id: a.line.id, second_charge_id: b.line.id,
          rejections_between: between.length,
          first_charge_was_refunded: firstWasRefunded
        }
      });
    }
  }

  // ---- PAIR GRAIN, gate 13 — duplicate payment ---------------------------
  // WIDER SCOPE: every entry-visa charge with a transaction, rejected or not, per
  // OWNER. Scoping this behind the rejection filter hid 134 of 176 duplicate-shaped
  // pairs worth AED 92,247.32, including the 62 cleanest ones.
  chargesByOwner.forEach(function (entries, ownerId) {
    const sorted = entries.slice().sort(function (x, y) {
      const tx = x.charge.time, ty = y.charge.time;
      if (tx !== null && ty !== null && tx !== ty) return tx - ty;
      return Number(x.charge.line.id || 0) - Number(y.charge.line.id || 0);
    });

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const A = sorted[i], B = sorted[j];
        const a = A.charge, b = B.charge;
        if (a.time === null || b.time === null) continue;

        // ORDERED JOIN ONLY. The earlier self-join used b.id <> a.id, which emits BOTH
        // orderings whenever two charges share a date — so every same-day figure was
        // DOUBLED. "22 pairs, AED 22,495" was really 11 pairs, AED 11,247.50.
        if (b.time < a.time || (b.time === a.time && Number(b.line.id || 0) <= Number(a.line.id || 0))) continue;

        const sameAmount = a.amount !== null && b.amount !== null && Math.abs(a.amount - b.amount) < 0.005;
        const sameDay = Math.abs(daysBetween(a.time, b.time)) < 1;

        // Both tests must pass. A rejection between the charges makes the second one a
        // legitimate re-application — the most common shape in the population.
        const rejectionsBetween = A.rejectionTimes.filter(function (t) { return t > a.time && t < b.time; }).length;

        // AND an Added refund between them is proof of a rejection THE HISTORY DID NOT
        // RECORD. ERP-confirmed on request 114752: two identical charges 32 days apart,
        // ZERO Rejected rows in the history, and a refund Added between them. The
        // history has false negatives — it missed 5 of 14, a 36% false-positive rate on
        // the history test alone, and every one it missed would have been a false
        // duplicate finding against a named person.
        const refundsBetween = A.refundsAddedTimes.concat(B.refundsAddedTimes)
          .filter(function (t) { return t > a.time && t < b.time; }).length;

        if (rejectionsBetween > 0 || refundsBetween > 0) continue;

        if (!sameAmount) {
          // Never score the ambiguous middle as a finding without a human. Different
          // amounts on the same day could be component lines of one fee rather than
          // duplicates.
          if (sameDay) {
            pairCases.push({
              grain: 'pair', gate: 13, order: 130,
              requestId: a.requestId, secondRequestId: b.requestId, ownerId: ownerId,
              verdict: VERDICT.VERIFIER,
              verdictName: 'Needs investigation — ambiguous same-day charge pair',
              why: 'Two entry-visa charges for the same person on the same day at DIFFERENT amounts, with ' +
                   'neither a rejection nor an Added refund between them. Could be component lines of a ' +
                   'single fee rather than a duplicate payment; only a human can say.',
              wasted: null,
              evidence: { same_day: true, same_amount: false }
            });
          }
          continue;
        }

        pairCases.push({
          grain: 'pair', gate: 13, order: 130,
          requestId: a.requestId, secondRequestId: b.requestId, ownerId: ownerId,
          verdict: VERDICT.FINDING,
          verdictName: 'Duplicate entry-visa payment',
          why: 'Two entry-visa charges for the same person at the SAME amount, with neither a rejection ' +
               'event nor an Added refund between them, and neither reversed. A refund taken between two ' +
               'charges is proof of a rejection the history did not record, so both tests are required.',
          // Valued at the duplicate charge IN FULL, not at a refundable constant — a
          // duplicate should never have been paid at all.
          wasted: b.amount,
          valuationBasis: 'the duplicate charge in full (gate 13: it should never have been paid)',
          evidence: {
            same_day: sameDay,
            days_apart: Math.round(daysBetween(a.time, b.time) * 10) / 10,
            cross_request: a.requestId !== b.requestId,
            first_charge_id: a.line.id, second_charge_id: b.line.id
          }
        });
      }
    }
  });

  // ---- declared gaps, surfaced in the run summary rather than absorbed ----
  const prematureCount = chargeCases.filter(function (c) { return c.defect === 'GATE-7-NO-MINIMUM-ELAPSED-GUARD'; }).length;
  if (prematureCount > 0) {
    declaredGaps.push({
      id: 'GATE-7-NO-MINIMUM-ELAPSED-GUARD',
      affected_cases: prematureCount,
      effect: 'Gate 7 has no minimum-elapsed guard, so a request abandoned fewer than ' +
              REFUND_WINDOW_DAYS + ' days after its rejection reds immediately — before anyone could ' +
              'reasonably have claimed the refund. These findings are real losses only if abandonment is ' +
              'accepted as overriding the window. OWNER RULING OPEN.'
    });
  }
  const untested = chargeCases.filter(function (c) { return c.untestedPath; }).length;
  if (untested > 0) {
    declaredGaps.push({
      id: 'GATE-9-UNTESTED-PATH',
      affected_cases: untested,
      effect: 'Gate 9 (refund claimed late) had ZERO cases in 11.5 months of measured data. Any case ' +
              'produced here is on a path that has never been exercised. Open ruling 3.'
    });
  }
  declaredGaps.push({
    id: 'GATE-10-VALUATION-IS-A-LOWER-BOUND',
    affected_cases: chargeCases.filter(function (c) { return c.verdict === VERDICT.FINDING; }).length,
    effect: 'Which refundable constant (' + REFUNDABLE_LOW + ' / ' + REFUNDABLE_HIGH + ') applies to which ' +
            'charge is NOT established. Purpose predicts it ~94% of the time and the amount band ~95%. ' +
            'Every recoverable figure here is a LOWER BOUND, never a settled amount. Open ruling 2 also asks ' +
            'whether the loss is the refundable portion or the whole fee — AED 105,758.50 versus 164,299.19 ' +
            'on identical cases.'
  });

  return {
    charge_cases: chargeCases,
    pair_cases: pairCases,
    declared_gaps: declaredGaps,
    summary: summarise(chargeCases, pairCases)
  };
}

/**
 * GATE 10 — valuation. The loss is the REFUNDABLE PORTION, never the fee we paid.
 * The prior manual run booked the whole fee and overstated its own 41-case tab by
 * AED 11,833.22 — 49% of it.
 *
 * Where the charge's purpose and its amount band DISAGREE about the type, the case is
 * not valued at all: it routes. 22 charge lines of 1,022.50 are booked under the
 * purpose named ENTRY_VISA_LESS_THAN_1000, so the purpose's own name contradicts its
 * amount and neither is a safe indicator on its own.
 */
function valueFinding(charge) {
  const amt = charge.amount;
  if (amt === null) {
    // Never substitute a standard fee for a missing amount, and never treat it as zero.
    return { value: null, basis: 'UNVALUED — the charge carries no amount; routes to the verifier' };
  }
  const bandClass = amt >= AMOUNT_BAND_BOUNDARY ? 'HIGH' : 'LOW';
  if (charge.purposeClass !== bandClass) {
    return {
      value: null,
      basis: 'UNVALUED — purpose (' + charge.purposeClass + ') and amount band (' + bandClass +
             ") disagree about this charge's type. Gate 10 routes rather than guessing."
    };
  }
  return {
    value: bandClass === 'HIGH' ? REFUNDABLE_HIGH : REFUNDABLE_LOW,
    basis: 'refundable constant for a ' + bandClass + ' charge — A LOWER BOUND, not a settled figure'
  };
}

function makeCase(o) {
  return {
    grain: 'charge',
    gate: o.gate, order: o.order,
    requestId: o.req.requestId,
    ownerId: o.req.ownerId,
    ownerType: o.req.ownerType,
    chargeId: o.charge ? o.charge.line.id : null,
    chargePurpose: o.charge ? o.charge.purposeRaw : null,
    verdict: o.verdict,
    verdictName: o.verdictName,
    why: o.why,
    recoverable: o.recoverable === undefined ? null : o.recoverable,
    valuationBasis: o.valuationBasis || null,
    untestedPath: o.untestedPath === true,
    defect: o.defect || null,
    evidence: o.evidence || {}
  };
}

/**
 * OUTPUT HYGIENE: counts, flags and totals. The per-entity amounts and identifiers
 * live on the case objects, which belong in the case store — never in a run summary a
 * human reads in passing.
 */
function summarise(chargeCases, pairCases) {
  const byVerdict = {};
  const byGate = {};
  let recoverableTotal = 0, unvalued = 0;

  chargeCases.forEach(function (c) {
    byVerdict[c.verdict] = (byVerdict[c.verdict] || 0) + 1;
    byGate['gate_' + c.gate] = (byGate['gate_' + c.gate] || 0) + 1;
    if (c.verdict === VERDICT.FINDING) {
      if (typeof c.recoverable === 'number') recoverableTotal += c.recoverable;
      else unvalued++;
    }
  });

  const pairByGate = {};
  let wastedTotal = 0;
  pairCases.forEach(function (p) {
    pairByGate['gate_' + p.gate + '_' + p.verdict] = (pairByGate['gate_' + p.gate + '_' + p.verdict] || 0) + 1;
    if (p.verdict === VERDICT.FINDING && typeof p.wasted === 'number') wastedTotal += p.wasted;
  });

  return {
    charge_grain: {
      total: chargeCases.length,
      by_verdict: byVerdict,
      by_gate: byGate,
      recoverable_lower_bound: Math.round(recoverableTotal * 100) / 100,
      findings_unvalued: unvalued
    },
    pair_grain: {
      total: pairCases.length,
      by_gate_and_verdict: pairByGate,
      wasted_total: Math.round(wastedTotal * 100) / 100
    }
  };
}

// ------------------------------- n8n call site -------------------------------------
// Input: ONE item carrying { requests: [...], as_of, run_id }.
// Output: ONE item carrying the cases, the declared gaps and the summary.
//
// The cases carry per-entity amounts and identifiers and are destined for the CASE STORE.
// The summary carries counts, flags and totals only. Nothing here prints a name, a contact
// detail or a salary, and the run summary is the only part a human reads in passing.

const input = $input.first().json || {};

if (!input || !Array.isArray(input.requests)) {
  // FAIL CLOSED. An absent population is not an empty one. Returning zero cases here would
  // read as "nothing wrong this month", which is the false clearance this whole check
  // exists to prevent.
  throw new Error('Score Cases: no population supplied (input.requests is not an array). ' +
    'Refusing to score. An absent population must never be scored as a clean run.');
}

const asOf = input.as_of || null;
if (!asOf) {
  throw new Error('Score Cases: as_of is missing. Gates 7 and 8 measure elapsed days from it, ' +
    'so scoring without it would make the run non-reproducible and the elapsed-day guard meaningless.');
}

const result = score({ requests: input.requests }, { asOf: asOf });

return [{ json: {
  run_id: input.run_id || null,
  as_of: asOf,
  scorer_version: 'scorer.js@' + (input.scorer_sha || 'unpinned'),
  charge_cases: result.charge_cases,
  pair_cases: result.pair_cases,
  declared_gaps: result.declared_gaps,
  summary: result.summary
} }];
