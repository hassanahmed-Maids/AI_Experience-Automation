// VERBATIM copy of the "Score Cases" node body from the n8n flow
// ABNaSxxRV6vzQTNi, wrapped so it can be exercised offline.
//
// This file is the SOURCE OF TRUTH: the node is generated from it. If you edit
// the node in the n8n UI, re-sync here and re-run this bench, or the deployed
// logic and the tested logic drift apart silently.

'use strict';

function scoreNode(cfg) {
  const HEADS = cfg.HEADS, FEE_ERAS = cfg.FEE_ERAS, REPLACEMENT_ERAS = cfg.REPLACEMENT_ERAS;
  const UNID84 = cfg.UNID84, SHORT = cfg.SHORT_LIVED_2026, FINE_ABOVE = cfg.FINE_CANDIDATE_ABOVE;

  function standardFeeOn(d) { for (const e of FEE_ERAS) if (d >= e.from && d <= e.to) return e.standard; return null; }
  function replacementFeeOn(d) { for (const e of REPLACEMENT_ERAS) if (d >= e.from && d <= e.to) return e.fee; return null; }

  function bandOf(amount, date) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'OFF_PRICE';
    const std = standardFeeOn(date), rep = replacementFeeOn(date);
    if (std !== null && amount === std) return 'STANDARD';
    if (rep !== null && Math.abs(amount - rep) <= 0.10) return 'REPLACEMENT';
    if (amount === UNID84.amount && date >= UNID84.from && date <= UNID84.to) return 'UNIDENTIFIED_84';
    if (SHORT.indexOf(amount) !== -1) return 'SHORT_LIVED_2026';
    return 'OFF_PRICE';
  }

  const SEV = { 'clean': 0, 'pending': 1, 'route to verifier': 2, 'finding': 3 };
  function worst(a, b) { return SEV[a] >= SEV[b] ? a : b; }

  const unclassifiedHeads = [];
  const scored = [];
  const parked = [];

  for (const r of cfg.rows) {
    const head = HEADS[r.expenseId];
    if (!head) { unclassifiedHeads.push(r.id); continue; }
    if (!r.date) throw new Error('ABORT: transaction ' + r.id + ' has no date');
    if (r.maidId === null || r.maidId === undefined || r.maidId === '') { parked.push(r); continue; }
    scored.push({
      id: r.id, maidId: String(r.maidId), expenseId: r.expenseId,
      phase: head.phase, category: head.category,
      date: r.date, amount: r.amount, transactionType: r.transactionType,
      band: bandOf(r.amount, r.date)
    });
  }

  const groups = new Map();
  for (const t of scored) {
    const key = t.maidId + '|' + t.phase + '|' + t.category;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const cases = [];
  for (const [key, txns] of groups) {
    txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id - b.id); });
    const nStd = txns.filter(function (t) { return t.band === 'STANDARD'; }).length;
    const nRep = txns.filter(function (t) { return t.band === 'REPLACEMENT'; }).length;
    const n84 = txns.filter(function (t) { return t.band === 'UNIDENTIFIED_84'; }).length;
    const nOff = txns.filter(function (t) { return t.band === 'OFF_PRICE'; }).length;
    const nShort = txns.filter(function (t) { return t.band === 'SHORT_LIVED_2026'; }).length;

    const gaps = [];
    for (let i = 1; i < txns.length; i++) {
      gaps.push(Math.round((Date.parse(txns[i].date) - Date.parse(txns[i - 1].date)) / 86400000));
    }
    const isReplacementCase = nStd <= 1 && nRep >= 1;

    for (const t of txns) {
      let v = null, rule = null, reason = null;
      if (nStd > 1 && t.band === 'STANDARD') { v = 'finding'; rule = 50; reason = 'Duplicate payment'; }
      if (v === null && t.band === 'REPLACEMENT') { v = 'route to verifier'; rule = 70; reason = isReplacementCase ? 'Replacement case' : 'Replacement alongside a duplicated application'; }
      if (v === null && t.amount !== null && t.amount > FINE_ABOVE) { v = 'pending'; rule = 80; reason = 'Fine candidate'; }
      if (v === null && t.band === 'UNIDENTIFIED_84') { v = 'pending'; rule = 90; reason = 'Unidentified charge'; }
      if (v === null && (t.amount === null || t.amount === 0 || t.transactionType === '')) { v = 'pending'; rule = 100; reason = 'No readable amount'; }
      if (v === null && t.band === 'OFF_PRICE' && t.amount !== null && t.amount > 0 && t.amount <= FINE_ABOVE) { v = 'pending'; rule = 110; reason = 'Off-price'; }
      if (v === null && t.band === 'STANDARD' && nStd === 1 && nRep === 0 && n84 === 0 && nOff === 0 && nShort === 0) { v = 'clean'; rule = 120; reason = 'One card, one price'; }
      if (v === null) {
        v = 'pending'; rule = 130;
        reason = t.band === 'SHORT_LIVED_2026' ? ('Unidentified charge (2026 short-lived band ' + t.amount + ')') : ('Unsettled by any gate (band ' + t.band + ')');
      }
      t.verdict = v; t.rule = rule; t.reason = reason;
    }

    let cv = 'clean';
    for (const t of txns) cv = worst(cv, t.verdict);

    cases.push({
      case_key: key, maid_id: txns[0].maidId, phase: txns[0].phase, category: txns[0].category,
      verdict: cv,
      rules_fired: Array.from(new Set(txns.map(function (t) { return t.rule; }))).sort(function (a, b) { return a - b; }).join(','),
      reasons: Array.from(new Set(txns.map(function (t) { return t.reason; }))).join(' | '),
      txn_count: txns.length,
      standard_count: nStd, replacement_count: nRep, unid84_count: n84, offprice_count: nOff,
      gap_days: gaps.join(','),
      amount_total: Math.round(txns.reduce(function (s, t) { return s + (t.amount || 0); }, 0) * 100) / 100,
      transaction_ids: txns.map(function (t) { return t.id; }).join(','),
      needs_verifier: txns.some(function (t) { return t.verdict === 'route to verifier'; })
    });
  }

  for (const r of parked) {
    cases.push({
      case_key: 'txn:' + r.id, maid_id: '', phase: (HEADS[r.expenseId] || {}).phase || 'UNKNOWN',
      category: (HEADS[r.expenseId] || {}).category || 'UNKNOWN',
      verdict: 'pending', rules_fired: '20',
      reasons: 'Identity unavailable (' + (cfg.identityDenial || 'no maid id on transaction') + ') - routed to review, never cleared',
      txn_count: 1, standard_count: 0, replacement_count: 0, unid84_count: 0, offprice_count: 0,
      gap_days: '', amount_total: r.amount || 0, transaction_ids: String(r.id), needs_verifier: false
    });
  }

  const tally = { finding: 0, 'route to verifier': 0, pending: 0, clean: 0 };
  for (const c of cases) tally[c.verdict]++;

  return {
    population_rows: cfg.rows.length,
    identity_available: !!cfg.identityAvailable,
    cases_total: cases.length,
    findings: tally.finding,
    route_to_verifier: tally['route to verifier'],
    pending: tally.pending,
    clean: tally.clean,
    unclassified_heads: unclassifiedHeads.length,
    unidentified_rows: parked.length,
    cases: cases
  };
}

const REFERENCE = {
  HEADS: {
    646:  { phase: 'NEW',   category: 'CC', canonical: 1594 },
    647:  { phase: 'RENEW', category: 'CC', canonical: 1631 },
    738:  { phase: 'NEW',   category: 'MV', canonical: 1682 },
    748:  { phase: 'RENEW', category: 'MV', canonical: 1719 },
    1594: { phase: 'NEW',   category: 'CC', canonical: 1594 },
    1631: { phase: 'RENEW', category: 'CC', canonical: 1631 },
    1682: { phase: 'NEW',   category: 'MV', canonical: 1682 },
    1719: { phase: 'RENEW', category: 'MV', canonical: 1719 }
  },
  FEE_ERAS: [
    { from: '0000-01-01', to: '2025-08-11', standard: 354.55 },
    { from: '2025-08-11', to: '9999-12-31', standard: 353.91 }
  ],
  REPLACEMENT_ERAS: [
    { from: '0000-01-01', to: '2025-08-09', fee: 454.55 },
    { from: '2025-08-09', to: '9999-12-31', fee: 454.62 }
  ],
  UNID84: { amount: 84.00, from: '2026-01-28', to: '2026-05-02' },
  SHORT_LIVED_2026: [382.10, 442.11],
  FINE_CANDIDATE_ABOVE: 454.72
};

module.exports = { scoreNode, REFERENCE };
