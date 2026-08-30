'use strict';
/**
 * CC Maids Salary Raise — verifier adjudication.
 *
 * The verifier AGENT reads prose (complaint initialDescription + comment threads) and returns a
 * STRUCTURED READING. This file turns that reading into a verdict, deterministically, in the
 * `Order` sequence of the eight LIVE verifier rules (80 · 85 · 90 · 105 · 108 · 110 · 112 · 115).
 *
 * WHY THE ARITHMETIC IS NOT LEFT TO THE MODEL. The single most error-prone line in the spec is
 * "an approved base is not a final salary" (verifier ❺, Order 85). Reading an approved figure as
 * a ceiling called maid 65604 "the strongest finding" during the rebuild when she is in fact
 * clean, and would have produced 3 false reds out of 5. The model is asked WHAT THE SENTENCE
 * SAYS; the composition of the allowance is done here, where it can be tested.
 *
 * The model's job:  extract amounts, dates, whether the thread APPROVES or REFUSES.
 * This file's job:  compose, compare, and pick the verdict.
 */

const { V, RULINGS, monthKey } = require('./scorer');

/**
 * @param det   the deterministic case from scoreMaid() — must be verdict 'candidate'
 * @param read  the verifier agent's structured reading:
 *   {
 *     sweep_reconciled: boolean,        // did the complaint walk reach totalElements
 *     authorisation_found: boolean,     // any complaint or salary To-do bearing on her pay
 *     approved_amount: number|null,     // the figure a human wrote
 *     approved_amount_is_base: boolean, // true = a starting salary; false = a stated FINAL salary
 *     approval_denied: boolean,         // the thread RECORDS A REFUSAL (To-do 648325 shape)
 *     renewal_raises_consumed_by_approval: number, // e.g. "+700" on a 350 nationality = 2
 *     renewals_since_approval: number|null,        // qualifying renewals AFTER the approval
 *     justification_is_cohort_wide: boolean,       // "everyone in this cohort gets it"
 *     addition_is_raise_in_disguise: boolean|null, // for the Order 62 ⓭ route only
 *     todo_ids: string[],
 *     documented_amounts: number[],     // amounts found that compose on NO single reading
 *     notes: string
 *   }
 */
function adjudicate(det, read, opts) {
  const o = opts || {};
  const rulings = o.rulings || RULINGS;
  const r = read || {};
  const trace = (det.trace || []).slice();
  const gaps = (det.gaps || []).slice();   // text only; det.gaps_detail carries the classification

  if (det.verdict !== V.CANDIDATE) {
    throw new Error(
      'ADJUDICATE CALLED ON A SETTLED CASE (maid ' + det.maid_id + ', verdict ' + det.verdict +
      '). Only Order 60 ❻ / 62 ⓭ / 48 ⓰ candidates reach the verifier. A settled case re-entering ' +
      'the verifier is how a later rule silently overrides an earlier gate\'s routing decision.'
    );
  }

  function fired(order, numeral, name, detail) { trace.push({ order, numeral, name, detail: detail || null }); }
  function settle(order, numeral, name, verdict, reason, extra) {
    fired(order, numeral, name, reason);
    return Object.assign({}, det, {
      verdict,
      settled_by: 'Verifier Order ' + order + ' ' + numeral,
      reason,
      trace,
      gaps,
      verifier_reading: {
        todo_ids: Array.isArray(r.todo_ids) ? r.todo_ids : [],
        sweep_reconciled: r.sweep_reconciled === true,
        authorisation_found: r.authorisation_found === true,
        approval_denied: r.approval_denied === true
      }
    }, extra || {});
  }

  const cap = rulings.renewal_raise_lifetime_cap;
  const paid = det.allowed + det.paid_vs_allowed;   // reconstructed from the deterministic case
  const raisePerRenewal = det.renewals_counted > 0
    ? (det.allowed - det.base) / det.renewals_counted
    : (Number.isFinite(o.raise_per_renewal) ? o.raise_per_renewal : 0);

  // ── Order 80 ❶ — Open the To-do; its type is not its content ───────────────────────────────
  // A PROMPT-SIDE rule, asserted here. The type arrives sometimes as {label:…} and sometimes as
  // a bare string, and it is NOT the content: on MOL 40311098689777 the type is 'Maid Wants To
  // Resign' and the raise inside it was DENIED. A type match is evidence a ticket exists, never
  // that it authorises anything. If the reading was produced from types alone, it is worthless.
  if (r.read_from_type_only === true) {
    return settle(80, '❶', 'Open the To-do; its type is not its content', V.PENDING,
      'the verifier reading was derived from To-do TYPES without opening the description and ' +
      'comment thread. A type is evidence a ticket exists, never that it authorises anything.');
  }

  // ── Order 85 ❺ — An approved base is not a final salary ────────────────────────────────────
  // Recorded, not decided: it governs how `approved_amount` is composed at Order 108/110 below.
  if (Number.isFinite(r.approved_amount)) {
    fired(85, '❺', 'An approved base is not a final salary',
      'an approved figure was found and is treated as ' +
      (r.approved_amount_is_base === false ? 'a STATED FINAL salary (the sentence names the ' +
        'resulting salary outright)' : 'an approved BASE, on top of which raises earned since ' +
        'still accrue') + '. Misreading this direction is the single most error-prone line in ' +
        'the spec.');
  }

  // A recorded REFUSAL is not an absence of authorisation — it is authorisation denied, and it
  // is the decisive counter-example the thread exists to carry (To-do 648325 looks like an
  // approval from its type and description and is a refusal in its thread).
  if (r.approval_denied === true) {
    return settle(112, '❼', 'A reconciled sweep finding no authorisation is the finding',
      r.sweep_reconciled === true ? V.FINDING : V.PENDING,
      r.sweep_reconciled === true
        ? 'the thread RECORDS A REFUSAL of the raise she is being paid. A denied raise is not ' +
          'an authorisation, and the sweep reconciled.'
        : 'the thread records a refusal, but the evidence sweep did not reconcile, so absence ' +
          'of a later approval is unprovable.');
  }

  // ── Order 90 ❷ — A blanket cohort pattern never clears an individual ───────────────────────
  // "561 of 798 sit at exactly 3,200" explains a cluster; it authorises nobody. If a standard is
  // wrong, fix the standard — never file it, and never clear on it, as a per-maid finding.
  if (r.justification_is_cohort_wide === true && !Number.isFinite(r.approved_amount)) {
    return settle(90, '❷', 'A blanket cohort pattern never clears an individual', V.PENDING,
      'the only justification offered is a cohort-wide pattern, which explains the cluster but ' +
      'authorises no individual. If the standard itself is wrong, fix the standard.');
  }

  // ── Order 105 ❻ — A persistent monthly addition is a raise in disguise ─────────────────────
  if (det.route_reason === 'recurring_addition_at_standard') {
    if (r.addition_is_raise_in_disguise === true) {
      if (r.authorisation_found === true && Number.isFinite(r.approved_amount)) {
        // fall through to the composition rules below — she has an approved figure to test.
        fired(105, '❻', 'A persistent monthly addition is a raise in disguise',
          'the recurring addition is judged a raise, and an approved figure exists to test it against');
      } else if (r.sweep_reconciled === true) {
        return settle(112, '❼', 'A reconciled sweep finding no authorisation is the finding',
          V.FINDING,
          'a raise is being paid through recurring monthly additions while her total salary ' +
          'reads at or below standard (the VPM-8374 shape), and a reconciled sweep found nothing ' +
          'authorising it.');
      } else {
        return settle(115, '❾', 'Evidence that neither clears nor convicts is pending', V.PENDING,
          'the recurring addition is judged a raise, but the evidence sweep did not reconcile.');
      }
    } else if (r.addition_is_raise_in_disguise === false) {
      return settle(105, '❻', 'A persistent monthly addition is a raise in disguise', V.CLEAN,
        'the recurring addition is judged a benefit rather than a raise, and her total salary ' +
        'is at or below her composed allowance.');
    } else {
      return settle(115, '❾', 'Evidence that neither clears nor convicts is pending', V.PENDING,
        'a recurring addition was detected but the verifier could not tell a raise from a benefit.');
    }
  }

  // ── Composition, shared by Order 108 ❽ and Order 110 ❹ ─────────────────────────────────────
  // The approved figure is the base UNLESS the sentence names the resulting salary outright.
  // Raises EARNED SINCE the approval still accrue, but only within what is left of the lifetime
  // cap after the approval itself consumed some.
  if (Number.isFinite(r.approved_amount)) {
    const consumed = Number.isFinite(r.renewal_raises_consumed_by_approval)
      ? r.renewal_raises_consumed_by_approval : 0;
    const remainingCap = Math.max(0, cap - consumed);
    const since = Number.isFinite(r.renewals_since_approval)
      ? r.renewals_since_approval
      : det.renewals_counted;          // fall back to the deterministic count
    const raisesSince = Math.min(since, remainingCap) * raisePerRenewal;
    const allowedV = r.approved_amount + raisesSince;

    // ── Order 108 ❽ — Evidence that composes EXACTLY to the paid amount clears that maid ─────
    // EXACTLY, and only for that record. Not "approximately", not "close enough".
    if (paid === allowedV) {
      return settle(108, '❽', 'Evidence that composes exactly to the paid amount clears that maid, that month',
        V.CLEAN,
        'an approved figure of ' + r.approved_amount +
        (r.approved_amount_is_base === false ? ' (a stated final salary)' : ' (an approved base)') +
        ', plus ' + Math.min(since, remainingCap) + ' renewal raise(s) earned since within the ' +
        'remaining lifetime cap of ' + remainingCap + ', composes EXACTLY to what she was paid.',
        { allowed_verified: allowedV, approved_amount: r.approved_amount,
          raises_since_approval: Math.min(since, remainingCap) });
    }

    // ── Order 110 ❹ — Paid above an approved figure is a reconciliation finding ──────────────
    if (paid > allowedV) {
      return settle(110, '❹', 'Paid above an approved figure is a reconciliation finding', V.FINDING,
        'she is paid above the figure an approver wrote plus every raise she has earned since. ' +
        (consumed > 0
          ? 'The approval itself consumed ' + consumed + ' of her ' + cap + ' lifetime renewal ' +
            'raises, so no further raise was available to her.'
          : ''),
        { allowed_verified: allowedV, approved_amount: r.approved_amount,
          raises_since_approval: Math.min(since, remainingCap),
          over_by: paid - allowedV });
    }

    // Paid BELOW the composed figure. Not a finding — this check looks upward only — but it does
    // not compose exactly either, so ❽ cannot clear her.
    return settle(115, '❾', 'Evidence that neither clears nor convicts is pending', V.PENDING,
      'an approved figure exists but composes ABOVE what she was actually paid, so the evidence ' +
      'does not reconcile on this reading. This check looks upward only, so it is not a finding.',
      { allowed_verified: allowedV, approved_amount: r.approved_amount });
  }

  // ── Order 112 ❼ — A reconciled sweep finding no authorisation IS the finding ───────────────
  // The main red, and it only holds because the sweep reconciled: at the default page size the
  // first 20 complaints showed nothing either, and concluding "no approval exists" from page 0
  // is a false absence in the direction that condemns.
  if (r.authorisation_found !== true) {
    if (r.sweep_reconciled === true) {
      return settle(112, '❼', 'A reconciled sweep finding no authorisation is the finding', V.FINDING,
        'the evidence sweep reconciled and NOTHING anywhere authorises the excess — no approved ' +
        'base, no raise To-do, no complaint bearing on her pay.');
    }
    return settle(25, '⓬', 'A walk that does not reconcile is unresolved, never clean', V.PENDING,
      'no authorisation was found, but the evidence sweep did not reconcile — so "not on a page" ' +
      'and "does not exist" are indistinguishable, and the false direction condemns.');
  }

  // ── Order 115 ❾ — Evidence that neither clears nor convicts is pending ─────────────────────
  // The last verifier rule. Documented amounts that compose on no single reading. Not a
  // clearance and not an accusation.
  return settle(115, '❾', 'Evidence that neither clears nor convicts is pending', V.PENDING,
    'raise authorisations exist and are documented, but no single reading of them composes to ' +
    'what she was paid — the arithmetic needs a human.' +
    (Array.isArray(r.documented_amounts) && r.documented_amounts.length
      ? ' Amounts found: ' + r.documented_amounts.length + ' distinct figures across ' +
        (Array.isArray(r.todo_ids) ? r.todo_ids.length : 0) + ' To-do(s).'
      : ''));
}

/**
 * Final safety net, run over EVERY case before delivery.
 * A case still holding `candidate` never reached a verifier verdict and must NOT drift to clean —
 * Order 78 ⓯ is explicit that anything no rule settled is pending, never clean.
 */
function finalise(cases) {
  return (cases || []).map(c => {
    if (c.verdict !== V.CANDIDATE) return c;
    return Object.assign({}, c, {
      verdict: V.PENDING,
      settled_by: 'Order 78 ⓯',
      reason: 'routed to the verifier but no verifier rule concluded — pending, never clean.'
    });
  });
}

module.exports = { adjudicate, finalise };
