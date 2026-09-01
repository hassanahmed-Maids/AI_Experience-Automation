// GENERATED FILE — do not edit here.
// Built by audit/r_visa/build-node.js from scorer.js + driver.js.
// This is the body of the "Assemble and Score Cases" node in
// n8n workflow 2yJCYs1YUZz7BVDG (R-Visa Audit · 1-Run).
// Edit scorer.js or driver.js and re-run the builder; never patch the node by hand.

// R-Visa Audit — deterministic scorer.
//
// Pure function, no I/O, no ERP access. Written standalone so it can be tested
// offline against the spec's test cases before any of it goes near n8n, and so a
// later refactor has a fixed reference: if the known-good numbers move, the
// refactor is wrong.
//
// Spec: "R-Visa Audit" v0.6 (Notion 3c2fe1c78bf0817190fac75010bf9703) and the 18
// rule rows tagged `Check = R-Visa Audit` on Audit Conditional Policy — Both Maids.
//
// ONE CASE = ONE MAID, carrying every R-visa payment she has ever had. Not one
// transaction, and not one calendar year: within 2025 only 2 maids have a repeat
// payment; all-time the figure is 182, so a window-scoped duplicate test misses
// roughly nine in ten cases.
//
// Gates run in ACP `Order`, which is NOT numeral order: ❻ carries numeral six but
// sits at Order 125 and therefore runs twelfth, after ⓬. Its condition matches
// every record today, so at its old Order 60 it routed the entire population to
// the verifier before any finding rule ran.


// ---------------------------------------------------------------- constants ---
// THREE OF THESE FOUR ARE REVERSE-ENGINEERED, NOT SOURCED. The base fee, the
// AED 50/day rate and the 60-day grace were derived from Khalil's dashboard
// arithmetic. They reconcile on 25 of 25 rows in 2025 and 15 of 15 off-base rows
// in 2026 — two independent periods, which proves consistency and never
// correctness. No authority tariff has been read. Every verdict that divides by
// them inherits that caveat.
const BASE_FEES = [446.65, 457.46, 346.65];
const FINE_PER_DAY = 50;
const GRACE_DAYS = 60;

// ❾'s renewal boundary. The empirical trough between the near-duplicate cluster
// and the renewal cluster, not a business rule — it needs the owner's sign-off
// before a single case is cleared by it.
const RENEWAL_GAP_DAYS = 601;

// ⓫'s duplicate band. The measurement says 30 is probably the WRONG boundary —
// the 31–90 day band is more enriched for the double-payment signature (78.6%)
// than the 0–30 band this gate reds (44.4%) — but widening it is a business
// decision with 69 pairs behind it and is not made here.
const DUPLICATE_GAP_DAYS = 30;

// The expense taxonomy cut over on this date. Before it, no account line means
// "R-visa" at all; from it, the head IS the product.
const TAXONOMY_CUTOVER = '2025-12-19';

// Money compares to the fils. Float subtraction of 798.05 − 446.65 lands at
// 351.40000000000003, so a bare % 50 would call a clean multiple fractional.
const EPSILON = 0.005;

// ------------------------------------------------------------------ helpers ---
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(-?\d{1,6})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { y: y, m: mo, d: d, t: Date.UTC(y, mo - 1, d) };
}

function daysBetween(a, b) {
  return Math.round((b.t - a.t) / 86400000);
}

function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------- ❶ population classifier --
// Two eras, two predicates. Getting this wrong in either direction is the single
// most expensive error available: expense-alone widens the population roughly
// tenfold, description-alone audits salary rows and client refunds, and the
// description test applied to the dedicated heads throws away a third of 2026.
const DEDICATED_HEAD_RE =
  /^(NEW|RENEW)\s*-\s*(MV|CC)\s+Housemaids\s*-\s*R-?visa\s+(Application\s+2\s+years|Modification)$/i;
const OFFICE_STAFF_HEAD_RE = /OfficeStaff/i;
const GENERIC_NEW_HEAD_RE = /^NEW\s*-\s*Immigration\s*-\s*(MV|CC)\s+Maids$/i;
const GENERIC_RENEWAL_HEAD_RE =
  /^Renewal\s+and\s+Cancellation\s*-\s*Immigration\s*-\s*(MV|CC)\s+Maids$/i;

const DESC_RVISA_RE = /R-?VISA/i;
const DESC_RENEW_RESIDENCE_RE = /Renew\s+Residence/i;
const DESC_CANCEL_RESIDENCE_RE = /cancel\s+residence/i;

// Returns { included, leg, reason }. `leg` is which predicate admitted the row,
// which the case must carry so a human can re-derive the population.
function classifyPayment(row) {
  const expense = norm(row.expense_name);
  const desc = norm(row.description);

  if (OFFICE_STAFF_HEAD_RE.test(expense)) {
    return { included: false, leg: null, reason: 'office-staff-out-of-scope' };
  }

  if (DEDICATED_HEAD_RE.test(expense)) {
    // The head is the product. Do NOT filter on the text here — 3,826 of 11,392
    // rows in 2026 (33.6%) never say R-VISA; they are the RENEW family and read
    // "Current Housemaid / Renew Residence".
    return { included: true, leg: 'dedicated-head', reason: null };
  }

  if (GENERIC_NEW_HEAD_RE.test(expense)) {
    if (DESC_CANCEL_RESIDENCE_RE.test(desc)) {
      return { included: false, leg: null, reason: 'cancellation-different-product' };
    }
    if (DESC_RVISA_RE.test(desc)) return { included: true, leg: 'generic-new-text', reason: null };
    if (DESC_RENEW_RESIDENCE_RE.test(desc)) {
      return { included: true, leg: 'generic-renewal-text', reason: null };
    }
    return { included: false, leg: null, reason: 'generic-head-text-not-rvisa' };
  }

  if (GENERIC_RENEWAL_HEAD_RE.test(expense)) {
    // Cancellations sit on this same expense name at a different price (median
    // AED 125.65, 5,364 rows in 2025). They are a different product.
    if (DESC_CANCEL_RESIDENCE_RE.test(desc)) {
      return { included: false, leg: null, reason: 'cancellation-different-product' };
    }
    // The pre-cutover renewal leg says R-VISA ZERO times in 10,855 rows. It is
    // found by "Renew Residence", and it is AED 2.16M that a text-only R-VISA
    // filter drops entirely.
    if (DESC_RENEW_RESIDENCE_RE.test(desc)) {
      return { included: true, leg: 'generic-renewal-text', reason: null };
    }
    if (DESC_RVISA_RE.test(desc)) return { included: true, leg: 'generic-new-text', reason: null };
    return { included: false, leg: null, reason: 'generic-head-text-not-rvisa' };
  }

  // Never drop an unrecognised expense name. A ninth expense value is how a whole
  // cohort disappears without erroring.
  return { included: false, leg: null, reason: 'unclassified-expense-head' };
}

function isRvisaExpense(expenseName) {
  const e = norm(expenseName);
  if (OFFICE_STAFF_HEAD_RE.test(e)) return false;
  return DEDICATED_HEAD_RE.test(e) || GENERIC_NEW_HEAD_RE.test(e) || GENERIC_RENEWAL_HEAD_RE.test(e);
}

function isRenewHead(expenseName) {
  const e = norm(expenseName);
  return DEDICATED_HEAD_RE.test(e) && /^RENEW/i.test(e);
}

// ------------------------------------------------------------ ❺ base fee -----
// NOT a lookup by date: the three bases OVERLAP (446.65 runs to 2025-12-31 and
// 457.46 starts 2025-07-07), so the period does not determine the value. Pick the
// base for which `amount − base` is a non-negative whole multiple of 50.
//
// ⛔ SPEC CORRECTION (filed 2026-08-30). The rule body justifies "park if more
// than one qualifies" with: "the bases differ by 10.81 and 100.00 — neither a
// multiple of 50 — so two bases can never both fit." THAT ARITHMETIC IS WRONG:
// 446.65 − 346.65 = 100.00 = 2 × 50 exactly. So 346.65 fits every amount that
// 446.65 fits, always, with two extra fine days. Implemented literally, the
// "park if more than one" clause fires on the ENTIRE 446.65 population — which
// is most of the check — and every record exits as `base-fee-unresolved`. The
// check would report nothing and look like it had simply found nothing.
//
// TIE-BREAK: take the HIGHEST base that fits, and annotate the ambiguity. A fine
// is the rare exception (25 of 14,409 positive 2025 rows, 0.17%), so the parse
// implying the FEWEST fine days is the right one. This reproduces every figure
// the spec verified independently — 92 fine days on transaction 1641662, 54 on
// 1526423, and 2/7/9 on the three 2026 overcharges — which the park-on-ambiguity
// reading cannot produce at all. The ambiguity is never hidden: it travels on the
// record so a reader can see which bases fitted.
function resolveBaseFee(amount) {
  const fits = [];
  for (let i = 0; i < BASE_FEES.length; i++) {
    const base = BASE_FEES[i];
    const remainder = amount - base;
    if (remainder < -EPSILON) continue;
    const days = remainder / FINE_PER_DAY;
    const nearest = Math.round(days);
    if (Math.abs(days - nearest) * FINE_PER_DAY <= EPSILON && nearest >= 0) {
      fits.push({ base: base, fine_days: nearest });
    }
  }
  if (fits.length === 0) return { ok: false, base: null, fine_days: null, candidates: 0 };
  fits.sort(function (a, b) { return b.base - a.base; });
  return {
    ok: true,
    base: fits[0].base,
    fine_days: fits[0].fine_days,
    candidates: fits.length,
    alternatives: fits.slice(1).map(function (f) { return { base: f.base, fine_days: f.fine_days }; })
  };
}

// ------------------------------------------------------------- ❼ / ❽ anchor --
// The clock starts at the LAST entry-visa payment on or before the R-visa payment.
// Load-bearing, not a detail: of the 40 fine rows since 2025, 6 have more than one
// candidate anchor and the worst choice moves the answer by 965 days.
function resolveAnchor(entryVisaPayments, txnDate) {
  let best = null;
  for (let i = 0; i < (entryVisaPayments || []).length; i++) {
    const p = entryVisaPayments[i];
    const d = parseDate(p.date);
    if (!d) continue;
    if (d.t <= txnDate.t && (best === null || d.t > best.date.t)) {
      best = { date: d, txn_id: p.txn_id, raw: p.date };
    }
  }
  const candidates = (entryVisaPayments || []).filter(function (p) {
    const d = parseDate(p.date);
    return d && d.t <= txnDate.t;
  }).length;
  return best ? { ok: true, anchor: best, candidates: candidates } : { ok: false, candidates: 0 };
}

// ------------------------------------------------------------------ scoring ---
const VERDICT_RANK = {
  'finding (red)': 4,
  'inconclusive': 3,
  'pending': 2,
  'route to verifier': 1,
  'clean (green)': 0
};

// The base fee ⓫ measures its surplus against. Reads the first base ❺ actually
// resolved rather than assuming records[0] resolved one — a record that parked at
// ❺ carries a null base, and a null here would make every surplus look infinite.
function resolvedBaseFor(records) {
  for (let i = 0; i < records.length; i++) {
    if (records[i].base_fee) return records[i].base_fee;
  }
  return BASE_FEES[0];
}

function worstVerdict(verdicts) {
  let out = null, rank = -1;
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    if (v == null) continue;
    const r = VERDICT_RANK[v];
    if (r === undefined) continue;
    if (r > rank) { rank = r; out = v; }
  }
  return out;
}

/**
 * Score one maid's whole R-visa payment history.
 *
 * @param {object} input
 *   maid_id                   - the ERP housemaid id. NEVER the name in the description.
 *   payments[]                - { txn_id, txn_date, amount, expense_name, expense_id,
 *                                description, description_date, creator }
 *   refunds[]                 - { txn_id, date, amount, expense_name }  (all-time, not window-scoped)
 *   entry_visa_payments[]     - { txn_id, date }
 *   visa_cycle                - { start, end } | null   (the route returns the LATEST request only)
 *   visa_history_markers[]    - e.g. ['Fill Previous Visa Info']
 *   cancellation_type         - null today: no per-maid route to the field exists
 *   rejection_status          - null today
 *   refund_request_date       - null today
 *   contract_term_years       - null today
 *   issued_visa_validity      - null today
 *   fine_repayment_responsibility - null today: never observed on a payload
 *   written_explanations{}    - txn_id -> prose, for the verifier layer
 * @param {object} options
 *   evaluate_zero_fine_rows   - see DECLARED GAP 3 below. Default false.
 */
function scoreCase(input, options) {
  const opts = options || {};
  const evaluateZeroFine = opts.evaluate_zero_fine_rows === true;
  const annotations = [];
  const records = [];

  // ---- ❷ Order 20 — identity ------------------------------------------------
  // Runs before every gate that reads a maid's history. Keyed on the id, 2 maids
  // have more than one 2025 payment; keyed on the normalised name, 56 groups
  // appear and 54 of them resolve to more than one distinct maid id — a ~4%
  // precise rule whose false positives are homonyms, which reconcile and never
  // look wrong.
  const maidId = input.maid_id;
  if (maidId === null || maidId === undefined || maidId === '') {
    return {
      maid_id: null,
      case_verdict: 'pending',
      case_reason: 'identity-unresolved',
      records: (input.payments || []).map(function (p) {
        return { txn_id: p.txn_id, verdict: 'pending', reason: 'identity-unresolved', gate: '❷', annotations: [] };
      }),
      annotations: ['identity-unresolved'],
      declared_gaps: declaredGaps()
    };
  }

  // ---- ❶ Order 10 — population ---------------------------------------------
  const included = [];
  const excluded = [];
  for (let i = 0; i < (input.payments || []).length; i++) {
    const p = input.payments[i];
    // A row that already carries `population_leg` was classified upstream by the
    // sweep, which is also where the raw description is dropped — so re-running
    // the text predicates here is both redundant and impossible. Only re-classify
    // rows that arrive unclassified (the offline fixtures).
    if (p.population_leg) { included.push({ row: p, leg: p.population_leg }); continue; }
    const c = classifyPayment(p);
    if (c.included) included.push({ row: p, leg: c.leg });
    else excluded.push({ txn_id: p.txn_id, reason: c.reason, expense_name: p.expense_name });
  }

  const sorted = included.slice().sort(function (a, b) {
    const da = parseDate(a.row.txn_date), db = parseDate(b.row.txn_date);
    if (!da || !db) return 0;
    return da.t - db.t;
  });

  // ---- ❸ Order 30 — refund netting, all-time, R-visa expenses only ----------
  // Never net a negative row whose expense is blank: 27 of the 28 non-positive
  // 2025 rows matching R-VISA are CLIENT refunds (−AED 83,558 in total) that
  // merely carry "pre R-visa cancellation" in a free-text reason. Netting them
  // would erase real findings wholesale. Never window-scope it either — refunds
  // land up to 74 days after the charge.
  let refundTotal = 0;
  const netted = [];
  for (let i = 0; i < (input.refunds || []).length; i++) {
    const r = input.refunds[i];
    if (!isRvisaExpense(r.expense_name)) continue;
    refundTotal += Math.abs(Number(r.amount) || 0);
    netted.push(r.txn_id);
  }
  const grossTotal = sorted.reduce(function (s, x) { return s + (Number(x.row.amount) || 0); }, 0);
  const netTotal = round2(grossTotal - refundTotal);
  if (netTotal < -EPSILON) annotations.push('negative-net-residual-failed-test');

  // ---- per-record gates -----------------------------------------------------
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i].row;
    const rec = {
      txn_id: row.txn_id,
      txn_date: row.txn_date,
      amount: Number(row.amount) || 0,
      expense_name: row.expense_name,
      expense_id: row.expense_id == null ? null : row.expense_id,
      population_leg: sorted[i].leg,
      verdict: null,
      reason: null,
      gate: null,
      annotations: [],
      fine_days_paid: null,
      fine_days_implied: null,
      base_fee: null
    };
    const txnDate = parseDate(row.txn_date);

    // -- ❹ Order 40 — date integrity. SUPPRESSES THE FINE GATES ONLY. --------
    // Verdict is deliberately EMPTY: this rule constrains a verdict, it does not
    // produce one, so a duplicate red on the same record can still fire. Test
    // case 1 is exactly that record — txn 1486146 is both a year-0025 date and
    // the second half of the duplicate pair on maid 105870.
    let fineGatesSuppressed = false;
    const descDate = parseDate(row.description_date);
    if (row.description_date && !descDate) {
      fineGatesSuppressed = true;
      rec.annotations.push('date-integrity:unparseable-description-date');
    } else if (descDate) {
      if (descDate.y < 1900) {
        fineGatesSuppressed = true;
        rec.annotations.push('date-integrity:description-year-before-1900');
      } else if (txnDate && Math.abs(daysBetween(descDate, txnDate)) > 31) {
        fineGatesSuppressed = true;
        rec.annotations.push('date-integrity:description-date-contradicts-transaction-date');
      }
    }
    // Record the suppression WHERE IT HAPPENS, not after ❺. A ❺ park used to
    // `continue` past the later annotation, so a record could be suppressed by ❹
    // and carry no trace of it.
    if (fineGatesSuppressed) rec.annotations.push('fine-gates-suppressed-by-date-integrity');

    // -- ❺ Order 50 — base fee. Narrows the expectation ❼/❽ test, so it runs
    //    first: with the base wrong the entire difference becomes fine days and
    //    the day-count comparison measures nothing. -------------------------
    const base = resolveBaseFee(rec.amount);
    if (!base.ok) {
      rec.verdict = 'pending';
      rec.reason = 'base-fee-unresolved';
      rec.gate = '❺';
      records.push(rec);
      continue;
    }
    rec.base_fee = base.base;
    rec.fine_days_paid = base.fine_days;
    if (base.candidates > 1) {
      rec.base_fee_alternatives = base.alternatives;
      rec.annotations.push('base-fee-ambiguous:' + base.candidates + '-bases-fit');
    }

    // -- ❼ Order 70 / ❽ Order 80 — the fine gates ---------------------------
    if (!fineGatesSuppressed && (rec.fine_days_paid > 0 || evaluateZeroFine)) {
      const anchor = resolveAnchor(input.entry_visa_payments, txnDate);
      if (!anchor.ok) {
        // Where there is none, the record parks rather than guessing.
        rec.verdict = 'pending';
        rec.reason = 'entry-visa-anchor-missing';
        rec.gate = '❼/❽';
        records.push(rec);
        continue;
      }
      rec.anchor_txn_id = anchor.anchor.txn_id;
      rec.anchor_date = anchor.anchor.raw;
      rec.anchor_candidates = anchor.candidates;
      if (anchor.candidates > 1) rec.annotations.push('anchor-ambiguous:' + anchor.candidates + '-candidates');

      const gap = daysBetween(anchor.anchor.date, txnDate);
      rec.fine_days_implied = gap - GRACE_DAYS;

      if (rec.fine_days_paid > rec.fine_days_implied) {
        rec.verdict = 'finding (red)';
        rec.reason = 'fine-days-above-date-gap';
        rec.gate = '❼';
        rec.loss_aed = round2((rec.fine_days_paid - rec.fine_days_implied) * FINE_PER_DAY);
      } else if (rec.fine_days_paid < rec.fine_days_implied) {
        rec.verdict = 'finding (red)';
        rec.reason = 'fine-days-below-date-gap';
        rec.gate = '❽';
        rec.shortfall_days = rec.fine_days_implied - rec.fine_days_paid;
      }
    }

    records.push(rec);
  }

  // ---- pairwise gates: ❾ Order 90, ❿ Order 100, ⓫ Order 110 ----------------
  const pairs = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1], cur = records[i];
    const dPrev = parseDate(prev.txn_date), dCur = parseDate(cur.txn_date);
    if (!dPrev || !dCur) continue;
    const gapDays = daysBetween(dPrev, dCur);
    const pair = {
      first_txn_id: prev.txn_id, second_txn_id: cur.txn_id,
      gap_days: gapDays, verdict: null, reason: null, gate: null,
      annotations: [], discriminator: null
    };

    // -- ❾ renewal. A renewal DECLARES ITSELF in the expense head; the 601-day
    //    threshold survives only as a fallback for rows predating the December
    //    2025 taxonomy, where no RENEW head existed. -------------------------
    const renewHead = isRenewHead(prev.expense_name) || isRenewHead(cur.expense_name);
    // SPEC CORRECTION FILED: the rule says the fallback applies to "rows
    // predating the December 2025 taxonomy" without saying WHICH row of a pair
    // decides when a pair straddles the cutover. Test case 2 (2024-05-22 →
    // 2026-08-19, gap 819, both on NEW heads) is expected clean, which is only
    // reachable if the EARLIER payment decides. Implemented that way; the
    // alternative reading yields `pending`, not a red, so neither reading
    // clears anything the other reds.
    const earlierPredatesCutover = parseDate(prev.txn_date).t < parseDate(TAXONOMY_CUTOVER).t;
    if (renewHead) {
      pair.verdict = 'clean (green)';
      pair.reason = 'renewal-declared-by-expense-head';
      pair.gate = '❾';
      pair.discriminator = 'renew-head';
    } else if (earlierPredatesCutover && gapDays >= RENEWAL_GAP_DAYS) {
      pair.verdict = 'clean (green)';
      pair.reason = 'renewal-by-day-gap-fallback';
      pair.gate = '❾';
      pair.discriminator = 'gap>=601 (pre-taxonomy fallback)';
    }

    // -- ❿ cancellation clearance. ANNOTATES AND ROUTES, never halts ⓫. ------
    // Its condition is true for every pair today (no route to the field exists),
    // so a terminal route here would make ⓫'s red — the check's cleanest
    // finding — permanently unreachable.
    if (input.cancellation_type === null || input.cancellation_type === undefined) {
      pair.annotations.push('cancellation-unverifiable');
      pair.routed_to_verifier = true;
    }

    // -- ⓫ duplicate. Prefer visa-cycle membership; fall back to the day gap,
    //    and SAY WHICH TEST WAS USED. -----------------------------------------
    if (pair.verdict !== 'clean (green)') {
      const cycle = input.visa_cycle;
      let insideOneCycle = null;
      if (cycle && cycle.start && cycle.end) {
        const cs = parseDate(cycle.start), ce = parseDate(cycle.end);
        if (cs && ce) {
          const prevIn = dPrev.t >= cs.t && dPrev.t <= ce.t;
          const curIn = dCur.t >= cs.t && dCur.t <= ce.t;
          // The route returns ONE request, the latest, so a payment predating it
          // cannot be assigned to its own cycle. Only a both-inside answer is
          // decidable here; anything else falls back to the gap.
          if (prevIn && curIn) insideOneCycle = true;
          else if (curIn && !prevIn) insideOneCycle = false;
        }
      }

      let isDuplicate = false;
      if (insideOneCycle === true) {
        isDuplicate = true;
        pair.discriminator = 'visa-cycle';
      } else if (insideOneCycle === false) {
        isDuplicate = false;
        pair.discriminator = 'visa-cycle (different requests — re-application)';
      } else {
        isDuplicate = gapDays <= DUPLICATE_GAP_DAYS;
        pair.discriminator = 'day-gap<=30 (proxy; cycle unreadable)';
      }

      // AND the charges net of refunds still exceed one base fee. Never call the
      // surplus a loss without ❸'s netting: a refunded double payment is not
      // money lost.
      const oneBase = resolvedBaseFor(records);
      const exceedsOneBase = netTotal > oneBase + EPSILON;
      if (isDuplicate && exceedsOneBase) {
        pair.verdict = 'finding (red)';
        pair.reason = 'double-payment';
        pair.gate = '⓫';
        pair.provisional = pair.routed_to_verifier === true;
        pair.loss_aed = round2(netTotal - oneBase);
      } else if (isDuplicate && !exceedsOneBase) {
        pair.annotations.push('duplicate-fully-refunded');
      }
    }
    pairs.push(pair);
  }

  // ---- ⓬ Order 120 — rejection sub-audit. Annotates, routes, never halts. ---
  // Today this matches every record, because both fields are unknown for all of
  // them. The run's summary must state IN WORDS that this sub-audit did not
  // execute; defaulting the rejection status to not-rejected is the most
  // expensive failure available here, because it is invisible.
  const rejectionUnexecuted =
    input.rejection_status === null || input.rejection_status === undefined ||
    input.refund_request_date === null || input.refund_request_date === undefined;
  if (rejectionUnexecuted) annotations.push('rejection-sub-audit-not-executed');

  // ---- ❻ Order 125 — visa term match. Runs TWELFTH. Annotates, never halts. --
  const termUnverifiable =
    (input.contract_term_years === null || input.contract_term_years === undefined) &&
    (input.issued_visa_validity === null || input.issued_visa_validity === undefined);
  if (termUnverifiable) annotations.push('term-unverifiable');

  // ---- ⓭ Order 130 — the deterministic floor -------------------------------
  // Never let silence mean clean. A verifier-routing annotation is not a verdict,
  // and neither is the fine-gate suppression at ❹.
  for (let i = 0; i < records.length; i++) {
    if (records[i].verdict === null) {
      records[i].verdict = 'pending';
      records[i].gate = '⓭';
      // The reason must name what actually stopped this record being settled, not
      // whichever annotation happens to sort first. Only ❹'s date-integrity
      // suppression is a REASON the record is unsettled — the spec requires a
      // date-suppressed record to fall here "carrying the date-integrity reason".
      // Everything else (a base-fee ambiguity that resolved, an anchor note) is
      // colour that already travels in `annotations`, and promoting it to the
      // reason makes an ordinary payment look like it had a data problem.
      const blocking = records[i].annotations.filter(function (a) {
        return a.indexOf('date-integrity:') === 0;
      });
      records[i].reason = blocking.length ? 'unsettled:' + blocking[0] : 'unsettled-no-gate-matched';
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].verdict === null) {
      pairs[i].verdict = 'pending';
      pairs[i].gate = '⓭';
      pairs[i].reason = 'duplicate-question-unsettled:gap-' + pairs[i].gap_days + 'd';
    }
  }

  // ---- verifier layer -------------------------------------------------------
  const verifier = runVerifier(input, records, pairs);

  // Verifier ❸'s `inconclusive` is a statement about the REJECTION SUB-AUDIT, not
  // about this maid: its condition is true for every case, because neither
  // rvisa_rejection_status nor rvisa_refund_request_date has ever been observed on
  // a payload. Left in the rollup it outranks `pending` and relabels EVERY
  // non-red case as inconclusive — which would report "we could not conclude
  // about this maid" when what is true is "one sub-audit did not run for anyone".
  // It stays in `verifier` and in `annotations`, and it is counted at run level;
  // it just does not decide the case verdict.
  const rollupVerifier = verifier.filter(function (v) {
    return !(v.scope === 'case' && v.reason === 'rejection-sub-audit-not-executed');
  });
  const allVerdicts = records.map(function (r) { return r.verdict; })
    .concat(pairs.map(function (p) { return p.verdict; }))
    .concat(rollupVerifier.map(function (v) { return v.verdict; }));

  return {
    maid_id: maidId,
    case_verdict: worstVerdict(allVerdicts),
    gross_aed: round2(grossTotal),
    refunded_aed: round2(refundTotal),
    net_aed: netTotal,
    payment_count: records.length,
    records: records,
    pairs: pairs,
    verifier: verifier,
    excluded: excluded,
    annotations: annotations,
    declared_gaps: declaredGaps()
  };
}

// ------------------------------------------------------------ verifier layer --
// Deterministic pre-adjudication of the verifier rules. Where a rule needs a
// judgement on prose, this returns the routing and the question; the model
// answers it. Silence never clears: the burden runs the other way, because a
// false clearance is invisible forever and an extra flag costs ten minutes.
function runVerifier(input, records, pairs) {
  const out = [];
  const explanations = input.written_explanations || {};

  // -- V❶ Order 140 — read the written reason before calling a duplicate a loss.
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const reachedVerifier = p.routed_to_verifier === true || p.gate === '⓫';
    if (!reachedVerifier) continue;
    const text = (explanations[p.first_txn_id] || '') + ' ' + (explanations[p.second_txn_id] || '');
    if (norm(text) === '') {
      // Never accept the absence of an explanation as an explanation.
      out.push({
        rule: 'V❶', order: 140, scope: 'pair', pair: p.first_txn_id + '/' + p.second_txn_id,
        verdict: null, reason: 'no-written-explanation', upholds: p.verdict === 'finding (red)'
      });
      continue;
    }
    out.push({
      rule: 'V❶', order: 140, scope: 'pair', pair: p.first_txn_id + '/' + p.second_txn_id,
      verdict: null, needs_model: true,
      question: 'Was the second payment a re-application after the first visa was cancelled or refused?',
      evidence_txn_ids: [p.first_txn_id, p.second_txn_id]
    });
  }

  // -- V❷ Order 150 — a fine with nobody assigned to repay it stays open.
  // Never raise this on a payment with no fine: only 25 of 14,409 positive 2025
  // rows carry a fine at all, so a gate that assumes one fires on the wrong 99.8%.
  const responsibility = input.fine_repayment_responsibility;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!(r.fine_days_paid > 0)) continue;
    if (responsibility === null || responsibility === undefined || norm(responsibility) === '') {
      out.push({
        rule: 'V❷', order: 150, scope: 'record', txn_id: r.txn_id,
        verdict: 'finding (red)', reason: 'fine-responsibility-unassigned',
        fine_aed: round2(r.fine_days_paid * FINE_PER_DAY)
      });
    }
  }

  // -- V❸ Order 160 — rejected-R-visa evidence is read, never inferred.
  const rejectionUnreadable =
    input.rejection_status === null || input.rejection_status === undefined ||
    input.refund_request_date === null || input.refund_request_date === undefined;
  if (rejectionUnreadable) {
    out.push({
      rule: 'V❸', order: 160, scope: 'case',
      verdict: 'inconclusive', reason: 'rejection-sub-audit-not-executed'
    });
  }

  // -- V❹ Order 170 — the verifier layer's floor.
  // Without it a duplicate pair with no written explanation and no fine matched
  // none of the three rules and exited with no verdict at all — which is the
  // single most common shape of this check's flagship red.
  for (let i = 0; i < out.length; i++) {
    if (out[i].verdict === null && !out[i].needs_model) {
      out[i].verdict = 'pending';
      out[i].floored_by = 'V❹';
      if (out[i].reason === 'no-written-explanation') out[i].reason = 'verifier-unsettled:no-written-explanation';
    }
  }
  return out;
}

// --------------------------------------------------------------- declared gaps -
// Every one of these changes a number in the run summary. They are returned with
// the result rather than left in a document, so a reader of the output cannot
// miss them.
function declaredGaps() {
  return [
    { id: 'G1', rule: '❻', text: 'Visa-term match not implemented: no route to the contract term or issued validity exists, so only one side of the comparison is held. Every record is annotated term-unverifiable and routed.' },
    { id: 'G2', rule: '⓬/V❸', text: 'Rejected-R-visa sub-audit did not execute: neither rvisa_rejection_status nor rvisa_refund_request_date has ever been observed on a payload. Affected records are inconclusive, not clean.' },
    { id: 'G3', rule: '❽', text: 'Fine gates are scoped to rows that actually carry a fine (fine_days_paid > 0). Applying them to zero-fine rows would test roughly 99.8% of the population against a fine that was never charged. Count of zero-fine rows that WOULD red under the wider reading is reported separately; set evaluate_zero_fine_rows to measure it.' },
    { id: 'G4', rule: '❿', text: 'Cancellation clearance cannot be proven: no per-maid route to a cancellation type exists, so every duplicate red is provisional pending verifier ❶.' },
    { id: 'G5', rule: '❺/❼/❽', text: 'The base fee, the AED 50/day rate and the 60-day grace are reverse-engineered from prior-art arithmetic and read from no authority tariff. They reconcile on two independent periods, which proves consistency and never correctness.' },
    { id: 'G6', rule: '⓫/❾', text: 'The 30-day duplicate band and the 601-day renewal boundary are empirical, not business rules. 69 all-time pairs fall between them and are red by no rule and clean by no rule; they report as pending.' },
    { id: 'G7', rule: '⓭', text: 'Only ❾ (renewal) and verifier ❶ (duplicate explained) can produce clean. Every ordinary payment that no gate reds therefore lands on the ⓭ floor as pending, by design — ⓭ exists so silence never means clean. Consequence for the run summary: pending is the MAJORITY state, not an exception, and it must never be folded into a clean count.' },
    { id: 'G8', rule: 'V❷', text: 'fine_repayment_responsibility has never been observed as a field, so every fine-bearing record reds at verifier ❷ as fine-responsibility-unassigned. That is the rule as written (never default to the company bearing it) and it is an inflation of the red count: roughly 25 records a year, AED 26,900 of fine days in 2025, none of which has ever been assigned.' }
  ];
}


// R-Visa Audit — n8n Code-node driver.
//
// Appended to scorer.js by build-node.js to produce the body of the
// "Assemble and Score Cases" node. Everything above this line is the SAME source
// the 91 offline assertions run against, so the flow and the tests cannot drift.

// ---------------------------------------------------------------- inputs -----
const cfg = $('Validate Inputs').first().json;
const pop = $('Verify Population').first().json;
const gate = $('ERP Budget Gate').first().json;
const identityChunks = $input.all().map(function (i) { return i.json; });

// ---- fold the identity chunks -------------------------------------------
const maidByTxn = {};
const denialByTxn = {};
const denialTotals = {};
let identityCalls = 0;
let chunksBlocked = 0;
for (let c = 0; c < identityChunks.length; c++) {
  const ch = identityChunks[c] || {};
  identityCalls += Number(ch.erp_calls) || 0;
  if (ch.blocked === true) chunksBlocked++;
  const res = Array.isArray(ch.results) ? ch.results : [];
  for (let r = 0; r < res.length; r++) {
    if (res[r].maid_id) maidByTxn[res[r].txn_id] = String(res[r].maid_id);
    else {
      denialByTxn[res[r].txn_id] = res[r].denial || 'UNKNOWN';
      const d = res[r].denial || 'UNKNOWN';
      denialTotals[d] = (denialTotals[d] || 0) + 1;
    }
  }
}
const requestedIdentity = (gate.identity_candidates || []).length;
// A permission refusal across every chunk is the check being unable to run, not a
// set of maids who happen to have no id. It becomes a declared gap on the run.
const identityBlocked = requestedIdentity > 0 && chunksBlocked === identityChunks.length;

// ---- split the population ------------------------------------------------
const allRows = pop.rows || [];
const charges = [];
const refunds = [];
for (let i = 0; i < allRows.length; i++) {
  if ((Number(allRows[i].amount) || 0) < 0) refunds.push(allRows[i]);
  else charges.push(allRows[i]);
}

// Entry-visa anchors for ❼/❽. Empty unless the operator supplied the head names.
const entryVisaByMaid = {};
const entryVisaRows = pop.entry_visa || [];
for (let i = 0; i < entryVisaRows.length; i++) {
  const m = maidByTxn[entryVisaRows[i].txn_id];
  if (!m) continue;
  if (!entryVisaByMaid[m]) entryVisaByMaid[m] = [];
  entryVisaByMaid[m].push({ txn_id: entryVisaRows[i].txn_id, date: entryVisaRows[i].txn_date });
}

// ---- group charges into cases -------------------------------------------
// One case = one maid. Rows whose maid we resolved group by maid id. Rows we
// never asked about (not fine-bearing, no contract sibling) cannot reach a red
// and are scored as single-payment cases so ❹ and ❺ still run on them and they
// land on the ⓭ floor rather than vanishing.
const byMaid = {};
const unidentified = [];
for (let i = 0; i < charges.length; i++) {
  const row = charges[i];
  const maid = maidByTxn[row.txn_id];
  if (maid) {
    if (!byMaid[maid]) byMaid[maid] = [];
    byMaid[maid].push(row);
  } else {
    unidentified.push(row);
  }
}

const refundsByMaid = {};
for (let i = 0; i < refunds.length; i++) {
  const m = maidByTxn[refunds[i].txn_id];
  if (!m) continue;
  if (!refundsByMaid[m]) refundsByMaid[m] = [];
  refundsByMaid[m].push({
    txn_id: refunds[i].txn_id, date: refunds[i].txn_date,
    amount: refunds[i].amount, expense_name: refunds[i].expense_name
  });
}

function toPayment(r) {
  return {
    txn_id: r.txn_id, txn_date: r.txn_date, amount: r.amount,
    expense_name: r.expense_name, expense_id: r.expense_id,
    population_leg: r.population_leg, description_date: r.description_date
  };
}

const scored = [];
const maidKeys = Object.keys(byMaid);
for (let k = 0; k < maidKeys.length; k++) {
  const maid = maidKeys[k];
  scored.push(scoreCase({
    maid_id: maid,
    payments: byMaid[maid].map(toPayment),
    refunds: refundsByMaid[maid] || [],
    entry_visa_payments: entryVisaByMaid[maid] || [],
    // No per-maid route to any of these exists today; each is a declared gap and
    // each rule already knows to annotate rather than default.
    visa_cycle: null,
    visa_history_markers: [],
    cancellation_type: null,
    rejection_status: null,
    refund_request_date: null,
    contract_term_years: null,
    issued_visa_validity: null,
    fine_repayment_responsibility: null,
    written_explanations: {}
  }));
}

// Single-payment cases for the rows we deliberately did not resolve.
for (let i = 0; i < unidentified.length; i++) {
  const row = unidentified[i];
  const res = scoreCase({
    maid_id: 'unidentified:txn:' + row.txn_id,
    payments: [toPayment(row)],
    refunds: [], entry_visa_payments: [],
    visa_cycle: null, visa_history_markers: [], cancellation_type: null,
    rejection_status: null, refund_request_date: null,
    contract_term_years: null, issued_visa_validity: null,
    fine_repayment_responsibility: null, written_explanations: {}
  });
  res.identity_state = denialByTxn[row.txn_id] ? 'unresolved:' + denialByTxn[row.txn_id] : 'not-required';
  scored.push(res);
}

// ---- roll up --------------------------------------------------------------
// Two grains, both reported. A case rolls up to one verdict per maid, but a maid
// can carry a red pair and two pending payments at once, and a summary that shows
// only the case grain reports "Pending: 0" for a run in which most RECORDS are
// pending — which reads as a contradiction beside the note explaining that
// pending is the majority state.
const counts = { red: 0, pending: 0, clean: 0, inconclusive: 0, route: 0 };
const recordCounts = { red: 0, pending: 0, clean: 0, inconclusive: 0, route: 0 };
function tally(bucket, v) {
  if (v === 'finding (red)') bucket.red++;
  else if (v === 'pending') bucket.pending++;
  else if (v === 'clean (green)') bucket.clean++;
  else if (v === 'inconclusive') bucket.inconclusive++;
  else if (v === 'route to verifier') bucket.route++;
}
let rowsWritten = 0;
// ⓬ requires the run to state IN WORDS that the rejection sub-audit did not
// execute, with a count of affected records. That count is every case, and it is
// reported here rather than by relabelling each case's verdict.
let rejectionSubauditNotExecuted = 0;
let lossAed = 0;
for (let i = 0; i < scored.length; i++) {
  tally(counts, scored[i].case_verdict);
  if ((scored[i].annotations || []).indexOf('rejection-sub-audit-not-executed') >= 0) rejectionSubauditNotExecuted++;
  const recs = scored[i].records || [];
  for (let r = 0; r < recs.length; r++) {
    tally(recordCounts, recs[r].verdict);
    rowsWritten++;
    if (recs[r].loss_aed) lossAed += recs[r].loss_aed;
  }
  const prs = scored[i].pairs || [];
  for (let p = 0; p < prs.length; p++) {
    tally(recordCounts, prs[p].verdict);
    rowsWritten++;
    if (prs[p].loss_aed) lossAed += prs[p].loss_aed;
  }
  const vfs = scored[i].verifier || [];
  for (let f = 0; f < vfs.length; f++) rowsWritten++;
}

// Gaps that change a number in the summary. Reported, never absorbed.
const runGaps = declaredGaps().map(function (g) { return g.id + ': ' + g.rule; });
if (identityBlocked) runGaps.push('BLOCKER: identity unreadable for every candidate — no red verdict can fire');
if (!pop.entry_visa_available) runGaps.push('BLOCKER: no entry-visa anchor heads supplied — fine gates ❼/❽ cannot clock a day count');
if (gate.contract_grouping_recall_gap) runGaps.push('RECALL: duplicates across two different contracts for one maid are not seen until the list payload carries a housemaid id');

return [{ json: {
  run_id: cfg.run_id,
  cases: scored,
  case_count: scored.length,
  counts: counts,
  record_counts: recordCounts,
  rows_written: rowsWritten,
  rejection_subaudit_not_executed: rejectionSubauditNotExecuted,
  loss_aed: Math.round(lossAed * 100) / 100,
  population_rows: allRows.length,
  charges: charges.length,
  refunds: refunds.length,
  rows_in_window: pop.rows_in_window,
  maids_identified: maidKeys.length,
  identity_requested: requestedIdentity,
  identity_resolved: Object.keys(maidByTxn).length,
  identity_unresolved: Object.keys(denialByTxn).length,
  identity_denials: denialTotals,
  identity_blocked: identityBlocked,
  identity_calls: identityCalls,
  declared_gaps: runGaps
} }];
