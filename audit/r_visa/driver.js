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
