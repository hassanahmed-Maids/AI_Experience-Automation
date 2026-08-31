'use strict';
/**
 * Proves the GENERATED n8n node body and the tested core agree, case for case.
 *
 * The first n8n build hand-copied the scorer and the copy had already drifted before it
 * ran. This test is what makes that impossible to repeat: it executes the emitted node
 * body in a sandbox with mocked n8n globals and compares every verdict against a direct
 * call into score-core. A drift fails here rather than in production.
 */
const fs = require('fs');
const core = require('./score-core.js');
const nodeSrc = fs.readFileSync(__dirname + '/dist/score-node.js', 'utf8');

let pass = 0, fail = 0;
const failures = [];
function t(name, a, e) {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) pass++; else { fail++; failures.push(name + '\n    expected ' + E + '\n    actual   ' + A); }
}

const SETUP = [
  { paymentRequestPurpose: { id: 2, name: 'Partial Refunds for Cancellation' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 5000,
    requireAttachment: false, bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 2 }, partialRefundForCancellationPaymentMethod: { label: 'Mild' },
    checkCeoLimit: true, limitForCeoApproval: 3000, requireAttachment: true,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 40, name: 'Removing Bad Google Review' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 3000,
    requireAttachment: true, bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 50, name: 'Full refund - freezing' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 6000,
    requireAttachment: false, bothAutoApproved: true, bankTransferAutoApproved: true, creditCardAutoApproved: true }
];

// A population deliberately containing the shapes that have broken this check before:
// an at-limit unsigned refund, a required-document-missing case, an auto-approved freeze,
// a purpose not in the partition, and a row carrying banking detail that must not travel.
const ROWS = [
  { id: 1, displayId: 'R-1', contract: 'C-1', contractType: 'CC', amount: 5000,
    purpose: { id: 2, name: 'Partial Refunds for Cancellation' }, managerAction: '', ceoAction: '',
    notes: 'client cancelled mid-month', iban: 'AE00', eid: 'X', accountName: 'Holder' },
  { id: 2, displayId: 'R-2', contract: 'C-2', contractType: 'CC', amount: 900,
    purpose: { id: 40, name: 'Removing Bad Google Review' }, managerAction: 'APPROVE',
    attachments: [], paymentProofAttachment: [], proofUploaded: false,
    managerNotes: 'review taken down' },
  { id: 3, displayId: 'R-3', contract: 'C-3', contractType: 'MV', amount: 120,
    purpose: { id: 50, name: 'Full refund - freezing' }, methodOfPayment: 'BANK_TRANSFER',
    managerAction: '', ceoAction: '' },
  { id: 4, displayId: 'R-4', contract: 'C-4', contractType: 'CC', amount: 50,
    purpose: { id: 999, name: 'Brand New Purpose' }, managerAction: 'APPROVE' },
  { id: 5, displayId: 'R-5', contract: '', contractType: 'CC', amount: 50,
    purpose: { id: 2, name: 'Partial Refunds for Cancellation' } }
];

// --- run the emitted node body with mocked n8n globals -------------------------------
function runNode(rows, setup) {
  const $input = { first: function () { return { json: { rows: rows } }; } };
  const $ = function (name) {
    if (name === 'Assert Config Checksum') return { first: function () { return { json: { config_ok: true, setup: setup } }; } };
    throw new Error('unexpected node reference: ' + name);
  };
  const console_ = { log: function () {} };
  const fn = new Function('$input', '$', 'console', nodeSrc);
  return fn($input, $, console_);
}

const emitted = runNode(ROWS, SETUP)[0].json;
const direct = ROWS.map(function (r) { return core.scoreRefundWithGroups(r, SETUP, {}); });

t('emitted node scores every row', emitted.cases.length, ROWS.length);
t('verdicts match the tested core exactly',
  emitted.cases.map(function (c) { return c.verdict; }),
  direct.map(function (c) { return c.verdict; }));
t('group routing matches the tested core exactly',
  emitted.cases.map(function (c) { return c.group || null; }),
  direct.map(function (c) { return c.group || null; }));
t('reasons match the tested core exactly',
  emitted.cases.map(function (c) { return c.reasons; }),
  direct.map(function (c) { return c.reasons; }));

// The population it was built from, verdict by verdict.
t('at-limit unsigned refund is a finding',        emitted.cases[0].verdict, 'finding');
t('required document missing is a finding',       emitted.cases[1].verdict, 'finding');
t('auto-approved freeze is pending, not clean',   emitted.cases[2].verdict, 'pending');
t('unmapped purpose is pending',                  emitted.cases[3].verdict, 'pending');
t('no contract is pending',                       emitted.cases[4].verdict, 'pending');
t('counts roll up correctly',
  emitted.counts, { scored: 5, findings: 2, pending: 3, clean: 0 });

// --- output hygiene on the emitted node ----------------------------------------------
const flat = JSON.stringify(emitted);
t('no IBAN reaches the case record',        /AE00/.test(flat), false);
t('no EID reaches the case record',         /"eid"/.test(flat), false);
t('no account name reaches the case record',/Holder/.test(flat), false);
t('no amount reaches the case record',      /"amount"/.test(flat), false);
// The note text DOES travel - it is bound for the workbook, and only the workbook.
t('the staff note travels for the workbook', /client cancelled mid-month/.test(flat), true);
t('and the key it came from is recorded',   Object.keys(emitted.cases[0].source_row), ['notes']);
t('note-key coverage is counted by KEY, not value',
  emitted.note_key_coverage, { notes: 1, managerNotes: 1, '(none)': 3 });

// --- the config-denied refusal --------------------------------------------------------
let denied = null;
try {
  const $input = { first: function () { return { json: { rows: ROWS } }; } };
  const $ = function () { return { first: function () { return { json: { config_ok: false, config_denied: '401 INSUFFICIENT_PERMISSIONS' } }; } }; };
  new Function('$input', '$', 'console', nodeSrc)($input, $, { log: function () {} });
} catch (e) { denied = e.message; }
t('a denied config refuses to score rather than scoring on an empty table',
  /REFUSING TO SCORE/.test(String(denied)), true);

console.log('\n' + (fail ? failures.join('\n\n') + '\n' : ''));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
