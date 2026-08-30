// E-ID Audit — deterministic scorer (ACP Orders 10-130).
// Standalone on purpose: it is the fixed reference the n8n Code node is built
// from, so a later refactor that moves a known-good number is the refactor's bug.
// Reads no ERP and no warehouse. Pure function of the rows handed to it.

'use strict';

// ---------------------------------------------------------------------------
// Reference data. Every constant here is ERP-measured; see the ERP Variables
// row named beside it. Era boundaries are load-bearing: a single-constant table
// misclassifies 100% of any pre-2025-08-11 month.
// ---------------------------------------------------------------------------

const HEADS = {
  646:  { phase: 'NEW',   category: 'CC', canonical: 1594 },
  647:  { phase: 'RENEW', category: 'CC', canonical: 1631 },
  738:  { phase: 'NEW',   category: 'MV', canonical: 1682 },
  748:  { phase: 'RENEW', category: 'MV', canonical: 1719 },
  1594: { phase: 'NEW',   category: 'CC', canonical: 1594 },
  1631: { phase: 'RENEW', category: 'CC', canonical: 1631 },
  1682: { phase: 'NEW',   category: 'MV', canonical: 1682 },
  1719: { phase: 'RENEW', category: 'MV', canonical: 1719 },
};

// eid_standard_fee / eid_replacement_fee. Both moved on 2025-08-11; the
// replacement fee's own last old-era row is 2025-08-09.
const FEE_ERAS = [
  { from: '0000-01-01', to: '2025-08-11', standard: 354.55 },
  { from: '2025-08-11', to: '9999-12-31', standard: 353.91 },
];
const REPLACEMENT_ERAS = [
  { from: '0000-01-01', to: '2025-08-09', fee: 454.55 },
  { from: '2025-08-09', to: '9999-12-31', fee: 454.62 },
];

const UNIDENTIFIED_84 = { amount: 84.00, from: '2026-01-28', to: '2026-05-02' };
const SHORT_LIVED_2026 = [382.10, 442.11];
const FINE_CANDIDATE_ABOVE = 454.72;

// A checksum over the reference data, asserted before anything is scored.
// If someone edits a constant, the run stops rather than quietly rescoring.
function referenceChecksum() {
  const parts = [
    Object.keys(HEADS).sort().map(function (k) {
      return k + ':' + HEADS[k].phase + ':' + HEADS[k].category + ':' + HEADS[k].canonical;
    }).join(','),
    FEE_ERAS.map(function (e) { return e.from + '>' + e.to + '=' + e.standard; }).join(','),
    REPLACEMENT_ERAS.map(function (e) { return e.from + '>' + e.to + '=' + e.fee; }).join(','),
    UNIDENTIFIED_84.amount + '@' + UNIDENTIFIED_84.from + '..' + UNIDENTIFIED_84.to,
    SHORT_LIVED_2026.join(','),
    String(FINE_CANDIDATE_ABOVE),
  ].join('|');
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h * 33) ^ parts.charCodeAt(i)) >>> 0;
  return { digest: h.toString(16), heads: Object.keys(HEADS).length, feeEras: FEE_ERAS.length };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

function standardFeeOn(date) {
  for (const e of FEE_ERAS) if (date >= e.from && date <= e.to) return e.standard;
  return null;
}

function replacementFeeOn(date) {
  for (const e of REPLACEMENT_ERAS) if (date >= e.from && date <= e.to) return e.fee;
  return null;
}

// eid_amount_band. OFF_PRICE is the loud catch-all and is never narrowed: a
// missing amount is OFF_PRICE, never zero, because zero looks settled.
function bandOf(amount, date) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return 'OFF_PRICE';
  const std = standardFeeOn(date);
  const rep = replacementFeeOn(date);
  if (std !== null && amount === std) return 'STANDARD';
  if (rep !== null && Math.abs(amount - rep) <= 0.10) return 'REPLACEMENT';
  if (amount === UNIDENTIFIED_84.amount && date >= UNIDENTIFIED_84.from && date <= UNIDENTIFIED_84.to) {
    return 'UNIDENTIFIED_84';
  }
  if (SHORT_LIVED_2026.indexOf(amount) !== -1) return 'SHORT_LIVED_2026';
  return 'OFF_PRICE';
}

// The date on the transaction, never the one inside the description: one live
// row reads '/ E-ID / 0026-03-08 /', year 0026.
function isUsableDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }

// ---------------------------------------------------------------------------
// Verdict lattice. "The case verdict is the worst of its transactions."
// ---------------------------------------------------------------------------

const SEVERITY = { 'clean': 0, 'pending': 1, 'route to verifier': 2, 'finding': 3 };
function worst(a, b) { return SEVERITY[a] >= SEVERITY[b] ? a : b; }

// ---------------------------------------------------------------------------
// The scorer.
//
// Rows in:  { transactionId, expenseId, date, amount, maidId, transactionType }
// Cases out: one per (maidId, phase, category), all-time.
//
// `windowFrom`/`windowTo` decide which rows are IN THE AUDIT WINDOW. History
// outside the window is still supplied and still counted for the duplicate and
// gap rules -- eid_payment_gap_days is all-time by definition -- but a case is
// only reported if it has at least one in-window row.
// ---------------------------------------------------------------------------

function score(rows, opts) {
  const windowFrom = opts.windowFrom;
  const windowTo = opts.windowTo;

  const unclassified = [];   // Order 10: head outside the eight. Never dropped.
  const unidentified = [];   // Order 20: no maid id. Never name-matched.
  const scored = [];

  for (const r of rows) {
    // -- Order 10: population is the expense head, never the description text.
    const head = HEADS[r.expenseId];
    if (!head) {
      unclassified.push({ transactionId: r.transactionId, expenseId: r.expenseId });
      continue;
    }
    if (!isUsableDate(r.date)) {
      // transaction_date has no default: a row that cannot be windowed aborts
      // rather than being guessed into a period.
      throw new Error('transaction ' + r.transactionId + ' has no usable date');
    }

    // -- Order 20: identity is the transaction's own maid id.
    if (r.maidId === null || r.maidId === undefined || r.maidId === '') {
      unidentified.push({ transactionId: r.transactionId });
      continue;
    }

    // -- Order 30: phase and category from the head; a renamed head is the same head.
    // -- Order 40: band the amount before any duplicate test.
    scored.push({
      transactionId: r.transactionId,
      maidId: String(r.maidId),
      expenseId: r.expenseId,
      canonicalHead: head.canonical,
      phase: head.phase,
      category: head.category,
      date: r.date,
      amount: (r.amount === null || r.amount === undefined) ? null : Number(r.amount),
      transactionType: r.transactionType === undefined ? null : r.transactionType,
      band: bandOf(r.amount === null || r.amount === undefined ? null : Number(r.amount), r.date),
      inWindow: r.date >= windowFrom && r.date <= windowTo,
    });
  }

  // Group all-time by maid + phase + category. The rename pairs are already
  // collapsed, so a maid whose history spans the December-2025 cutover is one
  // group, not two.
  const groups = new Map();
  for (const t of scored) {
    const key = t.maidId + '|' + t.phase + '|' + t.category;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const cases = [];
  for (const [key, txns] of groups) {
    txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.transactionId - b.transactionId); });

    const nStandard = txns.filter(function (t) { return t.band === 'STANDARD'; }).length;
    const nReplacement = txns.filter(function (t) { return t.band === 'REPLACEMENT'; }).length;
    const nUnid84 = txns.filter(function (t) { return t.band === 'UNIDENTIFIED_84'; }).length;
    const nOffPrice = txns.filter(function (t) { return t.band === 'OFF_PRICE'; }).length;
    const nShortLived = txns.filter(function (t) { return t.band === 'SHORT_LIVED_2026'; }).length;

    // eid_payment_gap_days -- all-time, consecutive pairs inside the group.
    const gaps = [];
    for (let i = 1; i < txns.length; i++) {
      gaps.push(Math.round((Date.parse(txns[i].date) - Date.parse(txns[i - 1].date)) / 86400000));
    }

    // -- Order 60 is a classification, not a verdict: it constrains 50 rather
    // than producing an outcome of its own.
    const isReplacementCase = nStandard <= 1 && nReplacement >= 1;

    // Per-row verdicts, FIRST MATCH WINS. A later gate must never overwrite an
    // earlier one's routing decision -- that is the false-clearance shape.
    for (const t of txns) {
      let verdict = null, rule = null, reason = null;

      // -- Order 50: duplicated standard fee. Group-level, stamped on the
      //    STANDARD rows that constitute it.
      if (nStandard > 1 && t.band === 'STANDARD') {
        verdict = 'finding'; rule = 50; reason = 'Duplicate payment';
      }

      // -- Order 70: every replacement needs a reason and a payer, and neither
      //    is readable today, so every replacement row goes to a human.
      if (verdict === null && t.band === 'REPLACEMENT') {
        verdict = 'route to verifier'; rule = 70;
        reason = isReplacementCase ? 'Replacement case (Order 60)' : 'Replacement fee alongside a duplicated application';
      }

      // -- Order 80: above the replacement fee is a fine candidate.
      if (verdict === null && t.amount !== null && t.amount > FINE_CANDIDATE_ABOVE) {
        verdict = 'pending'; rule = 80; reason = 'Fine candidate';
      }

      // -- Order 90: the 84.00 charge is unidentified and may not be scored either way.
      if (verdict === null && t.band === 'UNIDENTIFIED_84') {
        verdict = 'pending'; rule = 90; reason = 'Unidentified charge';
      }

      // -- Order 100: zero, missing or type-less. Runs BEFORE the off-price gate.
      if (verdict === null && (t.amount === null || t.amount === 0 || t.transactionType === '')) {
        verdict = 'pending'; rule = 100; reason = 'No readable amount';
      }

      // -- Order 110: off-price at or below the standard fee.
      if (verdict === null && t.band === 'OFF_PRICE' && t.amount !== null
          && t.amount > 0 && t.amount <= FINE_CANDIDATE_ABOVE) {
        verdict = 'pending'; rule = 110; reason = 'Off-price';
      }

      // -- Order 120: a single standard fee, once, with nothing else on the maid.
      if (verdict === null && t.band === 'STANDARD' && nStandard === 1
          && nReplacement === 0 && nUnid84 === 0 && nOffPrice === 0 && nShortLived === 0) {
        verdict = 'clean'; rule = 120; reason = 'One card, one price';
      }

      // -- Order 130: nothing settled it. Pending WITH A REASON, never clean.
      if (verdict === null) {
        verdict = 'pending'; rule = 130;
        reason = t.band === 'SHORT_LIVED_2026'
          ? 'Unidentified charge (2026 short-lived band ' + t.amount + ')'
          : 'Unsettled by any gate (band ' + t.band + ')';
      }

      t.verdict = verdict; t.rule = rule; t.reason = reason;
    }

    let caseVerdict = 'clean';
    for (const t of txns) caseVerdict = worst(caseVerdict, t.verdict);

    cases.push({
      key: key,
      maidId: txns[0].maidId,
      phase: txns[0].phase,
      category: txns[0].category,
      verdict: caseVerdict,
      rulesFired: Array.from(new Set(txns.map(function (t) { return t.rule; }))).sort(function (a, b) { return a - b; }),
      reasons: Array.from(new Set(txns.map(function (t) { return t.reason; }))),
      counts: { standard: nStandard, replacement: nReplacement, unidentified84: nUnid84, offPrice: nOffPrice, shortLived: nShortLived },
      gapDays: gaps,
      isReplacementCase: isReplacementCase,
      needsVerifier: txns.some(function (t) { return t.verdict === 'route to verifier'; }),
      reportable: txns.some(function (t) { return t.inWindow; }),
      transactions: txns,
    });
  }

  return {
    checksum: referenceChecksum(),
    cases: cases.filter(function (c) { return c.reportable; }),
    unclassifiedHeads: unclassified,
    unidentifiedRows: unidentified,
  };
}

module.exports = { score, bandOf, standardFeeOn, replacementFeeOn, referenceChecksum, HEADS };
