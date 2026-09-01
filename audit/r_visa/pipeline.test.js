// R-Visa Audit — integration test for the deployed n8n scoring node.
//
// Run: node audit/r_visa/pipeline.test.js
//
// scorer.test.js proves the RULES. This proves the GLUE: it executes
// dist/score-node.js — the exact body deployed to the "Assemble and Score Cases"
// node — with stubbed n8n bindings, against fixtures shaped like the real
// upstream node outputs. Everything between the sweep and the case store is
// otherwise untested code, and it is where a run reports the wrong number while
// every rule is individually correct.

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'dist', 'score-node.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  failures.push('  ✗ ' + name + '\n      expected: ' + e + '\n      actual:   ' + a);
}
function group(t) { console.log('\n' + t); }

// Executes the node body with n8n's $() and $input bound to fixtures.
function runNode(nodes, inputItems) {
  const $ = function (name) {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) {
      throw new Error('node body referenced an unknown node: ' + name);
    }
    return {
      first: function () { return { json: nodes[name] }; },
      all: function () { return [{ json: nodes[name] }]; }
    };
  };
  const $input = {
    first: function () { return { json: inputItems[0] }; },
    all: function () { return inputItems.map(function (j) { return { json: j }; }); }
  };
  const fn = new Function('$', '$input', SRC);
  return fn($, $input);
}

const CFG = {
  run_id: 'r-visa-test',
  check_id: 'r-visa-audit',
  window_from: '2025-09-01',
  window_to: '2025-09-30',
  started_at: '2026-08-31T00:00:00.000Z'
};

function row(o) {
  return {
    txn_id: o.txn_id,
    txn_date: o.txn_date,
    amount: o.amount,
    expense_name: o.expense_name || 'NEW - MV Housemaids - R-visa Application 2 years',
    expense_id: 1708,
    population_leg: 'dedicated-head',
    description_date: o.description_date || null,
    contract_id: o.contract_id || null
  };
}

// ═══════════════════════════════════ A: the flagship red survives the glue ════
group('A — spec test case 1 reaches its red through the real node body');
{
  // Maid 105870: two AED 446.65 fees four days apart, the second carrying a
  // year-0025 description date. Both are contract siblings, so both are identity
  // candidates and both resolve.
  const pop = {
    rows: [
      row({ txn_id: 1482201, txn_date: '2025-09-13', amount: 446.65, description_date: '2025-09-13', contract_id: 'C1' }),
      row({ txn_id: 1486146, txn_date: '2025-09-17', amount: 446.65, description_date: '0025-09-13', contract_id: 'C1' })
    ],
    entry_visa: [],
    entry_visa_available: false,
    rows_in_window: 2,
    pages_fetched: 3
  };
  const gate = { identity_candidates: [1482201, 1486146], contract_grouping_recall_gap: true };
  const identity = [{
    requested: 2, resolved: 2, unresolved: 0, blocked: false, erp_calls: 2,
    results: [
      { txn_id: 1482201, maid_id: '105870', denial: null },
      { txn_id: 1486146, maid_id: '105870', denial: null }
    ]
  }];

  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate }, identity)[0].json;

  check('one case, keyed on the maid', out.case_count, 1);
  check('the case is the maid, not the transaction', out.cases[0].maid_id, '105870');
  check('both payments landed in it', out.cases[0].payment_count, 2);
  check('the case verdict is a finding', out.cases[0].case_verdict, 'finding (red)');
  check('reds counted', out.counts.red, 1);
  check('the pair reds at ⓫', out.cases[0].pairs[0].gate, '⓫');
  check('loss is one surplus base fee', out.loss_aed, 446.65);
  check('identity was not blocked', out.identity_blocked, false);
  check('identity resolved for both', out.identity_resolved, 2);
  // ❹ suppressed the fine gates on the year-0025 row without parking the record.
  const rec = out.cases[0].records.filter(function (r) { return r.txn_id === 1486146; })[0];
  check('❹ suppressed the fine gates, not the record',
    rec.annotations.indexOf('fine-gates-suppressed-by-date-integrity') >= 0, true);
}

// ═══════════════════════════ B: a blocked identity read never reports clean ═══
group('B — a population-wide permission refusal is declared, never absorbed');
{
  const pop = {
    rows: [
      row({ txn_id: 1482201, txn_date: '2025-09-13', amount: 446.65, contract_id: 'C1' }),
      row({ txn_id: 1486146, txn_date: '2025-09-17', amount: 446.65, contract_id: 'C1' })
    ],
    entry_visa: [], entry_visa_available: false, rows_in_window: 2, pages_fetched: 3
  };
  const gate = { identity_candidates: [1482201, 1486146], contract_grouping_recall_gap: true };
  const identity = [{
    requested: 2, resolved: 0, unresolved: 2, blocked: true, erp_calls: 2,
    blocking_reason: 'INSUFFICIENT_PERMISSIONS on GET /accounting/transactions/{id} for every transaction in this chunk',
    results: [
      { txn_id: 1482201, maid_id: null, denial: 'INSUFFICIENT_PERMISSIONS' },
      { txn_id: 1486146, maid_id: null, denial: 'INSUFFICIENT_PERMISSIONS' }
    ]
  }];

  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate }, identity)[0].json;

  check('the run declares itself blocked', out.identity_blocked, true);
  // THE POINT: the same two payments that red in test A cannot red here, and the
  // run must say so rather than reporting a clean sheet.
  check('no red can fire without identity', out.counts.red, 0);
  check('and nothing was reported clean', out.counts.clean, 0);
  check('every row is pending instead', out.counts.pending, 2);
  const hasBlocker = out.declared_gaps.filter(function (g) { return g.indexOf('BLOCKER: identity unreadable') === 0; }).length;
  check('the blocker is a declared gap on the run', hasBlocker, 1);
  check('the denial reason is carried, not swallowed', out.identity_denials, { INSUFFICIENT_PERMISSIONS: 2 });
  check('each row records WHY it is unresolved',
    out.cases[0].identity_state, 'unresolved:INSUFFICIENT_PERMISSIONS');
}

// ═════════════════════ C: rows we deliberately never resolved still get scored ═
group('C — non-candidate rows are scored, not dropped');
{
  // A lone payment with no fine and no contract sibling. It cannot reach a red,
  // so identity was never requested for it — but it must still be examined by ❹
  // and ❺ and land on the ⓭ floor rather than vanishing from the population.
  const pop = {
    rows: [
      row({ txn_id: 900001, txn_date: '2025-09-05', amount: 446.65, contract_id: 'C9' }),
      row({ txn_id: 900002, txn_date: '2025-09-06', amount: 798.05, contract_id: 'C8' })
    ],
    entry_visa: [], entry_visa_available: false, rows_in_window: 2, pages_fetched: 2
  };
  const gate = { identity_candidates: [], contract_grouping_recall_gap: true };
  const identity = [{ requested: 0, resolved: 0, unresolved: 0, blocked: false, erp_calls: 0, results: [] }];

  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate }, identity)[0].json;

  check('both rows produced a case', out.case_count, 2);
  check('nothing was blocked (we never asked)', out.identity_blocked, false);
  check('and they are marked not-required, not unresolved',
    out.cases[0].identity_state, 'not-required');
  // The 798.05 row is the spec's sixth test case: it fits no base fee plus any
  // multiple of 50 and must park at ❺ rather than be absorbed.
  const odd = out.cases.filter(function (c) { return c.records[0].txn_id === 900002; })[0];
  check('the 798.05 row parks at ❺', odd.records[0].gate, '❺');
  check('naming the base fee as the suspect', odd.records[0].reason, 'base-fee-unresolved');
  check('no reds', out.counts.red, 0);
}

// ═══════════════════════ D: refunds net, and a netted duplicate is not a loss ══
group('D — ❸ netting reaches ⓫ through the glue');
{
  const pop = {
    rows: [
      row({ txn_id: 8101, txn_date: '2025-09-13', amount: 446.65, contract_id: 'C2' }),
      row({ txn_id: 8102, txn_date: '2025-09-17', amount: 446.65, contract_id: 'C2' }),
      // A genuine R-visa fee refund arrives as a NEGATIVE row in the same sweep.
      row({ txn_id: 1172259, txn_date: '2025-11-20', amount: -446.65, contract_id: 'C2' })
    ],
    entry_visa: [], entry_visa_available: false, rows_in_window: 3, pages_fetched: 2
  };
  const gate = { identity_candidates: [8101, 8102, 1172259], contract_grouping_recall_gap: true };
  const identity = [{
    requested: 3, resolved: 3, unresolved: 0, blocked: false, erp_calls: 3,
    results: [
      { txn_id: 8101, maid_id: '999', denial: null },
      { txn_id: 8102, maid_id: '999', denial: null },
      { txn_id: 1172259, maid_id: '999', denial: null }
    ]
  }];

  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate }, identity)[0].json;

  check('the negative row was split out as a refund', out.refunds, 1);
  check('and the two charges remain', out.charges, 2);
  check('the refund netted against the case', out.cases[0].refunded_aed, 446.65);
  check('a fully refunded duplicate is not a loss', out.counts.red, 0);
  check('and the pair says so',
    out.cases[0].pairs[0].annotations.indexOf('duplicate-fully-refunded') >= 0, true);
}

// ═══════════════════════════════ E: run-level gaps always travel ══════════════
group('E — declared gaps and the recall gap always reach the run');
{
  const pop = { rows: [], entry_visa: [], entry_visa_available: false, rows_in_window: 0, pages_fetched: 1 };
  const gate = { identity_candidates: [], contract_grouping_recall_gap: true };
  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate },
    [{ requested: 0, resolved: 0, unresolved: 0, blocked: false, erp_calls: 0, results: [] }])[0].json;

  check('an empty population is not an error', out.case_count, 0);
  const recall = out.declared_gaps.filter(function (g) { return g.indexOf('RECALL:') === 0; }).length;
  check('the contract-grouping recall gap is declared', recall, 1);
  const anchorGap = out.declared_gaps.filter(function (g) { return g.indexOf('BLOCKER: no entry-visa') === 0; }).length;
  check('the missing entry-visa anchor is declared', anchorGap, 1);
  check('the eight standing gaps are all present',
    out.declared_gaps.filter(function (g) { return /^G[1-8]:/.test(g); }).length, 8);
}

// ═══════════ F: the two grains, and a reason that names the real blocker ══════
group('F — record grain is reported beside case grain');
{
  // One maid, one red pair, two pending payments. Reporting only the case grain
  // shows "pending: 0" for a run whose records are mostly pending — which reads as
  // a contradiction next to the note saying pending is the majority state.
  const pop = {
    rows: [
      row({ txn_id: 1482201, txn_date: '2025-09-13', amount: 446.65, description_date: '2025-09-13', contract_id: 'C1' }),
      row({ txn_id: 1486146, txn_date: '2025-09-17', amount: 446.65, description_date: '0025-09-13', contract_id: 'C1' })
    ],
    entry_visa: [], entry_visa_available: false, rows_in_window: 2, pages_fetched: 15
  };
  const gate = { identity_candidates: [1482201, 1486146], contract_grouping_recall_gap: true };
  const identity = [{
    requested: 2, resolved: 2, unresolved: 0, blocked: false, erp_calls: 2,
    results: [
      { txn_id: 1482201, maid_id: '105870', denial: null },
      { txn_id: 1486146, maid_id: '105870', denial: null }
    ]
  }];
  const out = runNode({ 'Validate Inputs': CFG, 'Verify Population': pop, 'ERP Budget Gate': gate }, identity)[0].json;

  check('one case, and it is red', out.counts, { red: 1, pending: 0, clean: 0, inconclusive: 0, route: 0 });
  check('but the records are two pending and one red pair',
    out.record_counts, { red: 1, pending: 2, clean: 0, inconclusive: 0, route: 0 });
  // 2 payments + 1 pair + V❶ + V❸ = 5 rows land in the case store.
  check('rows written to the case store', out.rows_written, 5);
  check('the rejection sub-audit is counted, not folded into a verdict',
    out.rejection_subaudit_not_executed, 1);

  const recs = out.cases[0].records;
  // A base fee that resolved with two candidates is colour, not a reason. Before
  // the fix an ordinary payment reported reason "unsettled:base-fee-ambiguous",
  // which reads as a data problem it does not have.
  const clean = recs.filter(function (r) { return r.txn_id === 1482201; })[0];
  check('an ordinary payment says only that no gate matched', clean.reason, 'unsettled-no-gate-matched');
  check('the base-fee ambiguity still travels as an annotation',
    clean.annotations.indexOf('base-fee-ambiguous:2-bases-fit') >= 0, true);
  // ❹'s suppression IS a reason, and the spec requires it to be carried.
  const suppressed = recs.filter(function (r) { return r.txn_id === 1486146; })[0];
  check('a date-suppressed record carries the date-integrity reason',
    suppressed.reason, 'unsettled:date-integrity:description-year-before-1900');
  check('the expense id reaches the case store', clean.expense_id, 1708);
}

console.log('\n' + '─'.repeat(66));
if (failures.length) { console.log(failures.join('\n')); console.log('─'.repeat(66)); }
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
