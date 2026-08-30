'use strict';

/**
 * ILOE Checker — offline test suite.
 *
 * Seven cases from the spec's own test table, plus a guard for every edge the
 * rules explicitly name. Fixture values are the ones the spec records from its
 * live ERP reads on 2026-08-20; staff names are never included.
 */

const S = require('./iloe_scorer');

const SUB_MV_NEW = 'NEW - MV Housemaids - ILOE Subscription';
const SUB_CC_NEW = 'NEW - CC Housemaids - ILOE Subscription';
const SUB_MV_RENEW = 'RENEW - MV Housemaids - ILOE Subscription';
const FINES_MV_NEW = 'NEW - MV Housemaids - ILOE Fines';

function pay(txn_id, maid_id, date, expense_name, amount, expense_id) {
  return { txn_id: txn_id, maid_id: maid_id, date: date, expense_name: expense_name, amount: amount, expense_id: expense_id || 1693 };
}
function loan(loanType, amount, loanDate, waivedAmount, waiveNotes, status, id) {
  return {
    id: id || null, loanType: loanType, amount: amount, loanDate: loanDate,
    waivedAmount: waivedAmount || 0, waiveNotes: waiveNotes || '',
    status: status || 'Not Yet Paid', remainingAmount: amount, repaidAmount: 0,
  };
}

const tests = [];
function t(name, input, expect) { tests.push({ name: name, input: input, expect: expect }); }

// ─────────────────────────── the spec's seven test cases ───────────────────

t('SPEC 1 — maid 127260: MV, no ILOE loan ever → finding (not recovered), 126',
  {
    audited_month: '2026-03',
    payments: [pay(1811563, 127260, '2026-03-18', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '127260': [] },
  },
  { verdict: 'finding', label: 'ILOE not recovered', finding_aed: 126.0, fired: 'G5' });

t('SPEC 2 — maid 132336: two same-day payments, both loaned → finding (paid twice), excess 126',
  {
    audited_month: '2026-06',
    payments: [
      pay(1970166, 132336, '2026-06-15', SUB_MV_NEW, 126.0),
      pay(1970167, 132336, '2026-06-15', SUB_MV_NEW, 126.0),
    ],
    loans_by_maid: {
      '132336': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-14 20:16:14', 0, '', 'Paid', 'L1'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-14 20:17:06', 2.0,
             '2 AED were waived by A Staff Member on 11/07/2026 because Duplicate', 'Paid', 'L2'),
      ],
    },
  },
  { verdict: 'finding', label: 'ILOE paid twice', finding_aed: 126.0, fired: 'G9', ownerTxn: 1970167 });

t('SPEC 3 — maid 65876: paid 126, loaned 123 → finding (short), 3.00',
  {
    audited_month: '2026-08',
    payments: [pay(2081900, 65876, '2026-08-15', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '65876': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 123.0, '2026-08-14 19:46:27')] },
  },
  { verdict: 'finding', label: 'ILOE short', finding_aed: 3.0, fired: 'G7' });

t('SPEC 4 — maid 137833: paid 126, loaned 126, nothing waived → clean',
  {
    audited_month: '2026-07',
    payments: [pay(1990390, 137833, '2026-07-01', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '137833': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-30 05:13:53')] },
  },
  { verdict: 'clean', label: 'Recovered', finding_aed: 0, fired: 'G10' });

t('SPEC 5 — maid 132174: loan fully waived, note names approver + Escalation → clean (explained)',
  {
    audited_month: '2026-06',
    payments: [pay(1930001, 132174, '2026-06-16', SUB_MV_NEW, 126.0)],
    loans_by_maid: {
      '132174': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-16 09:00:00', 126.0,
             '126 AED were waived by A Staff Member on 26/06/2026 because Escalation', 'Paid'),
        loan('UNEMPLOYMENT_INSURANCE_FINES', 402.86, '2026-06-16 09:00:00', 402.86,
             '403 AED were waived by A Staff Member on 26/06/2026 because Escalation', 'Paid'),
      ],
    },
  },
  { verdict: 'clean', label: 'Written off with authority', finding_aed: 0, fired: 'G8' });

t('SPEC 6 — maid 121794: CC, no ILOE loan → pending (awaiting the CC ruling)',
  {
    audited_month: '2026-04',
    payments: [pay(1869306, 121794, '2026-04-22', SUB_CC_NEW, 126.0, 1605)],
    loans_by_maid: { '121794': [] },
  },
  { verdict: 'pending', label: 'Awaiting the CC ruling', finding_aed: 0, fired: 'G6' });

t('SPEC 7 — maid 132396: +126 then −126 fifty-one days later → pending (reversed, out of scope)',
  {
    audited_month: '2026-05',
    payments: [
      pay(1920424, 132396, '2026-05-21', SUB_MV_NEW, 126.0),
      pay(2028002, 132396, '2026-07-11', SUB_MV_NEW, -126.0),   // lookahead row
    ],
    loans_by_maid: { '132396': [] },
  },
  { verdict: 'pending', label: 'Reversed, out of scope', finding_aed: 0, fired: 'G12' });

// ─────────────────────────── edge guards the rules name ────────────────────

t('GUARD — staff expense is excluded at the population gate, never a case',
  {
    audited_month: '2026-06',
    payments: [
      { txn_id: 9001, maid_id: null, date: '2026-06-05', expense_name: 'ILOE Mandatory Insurance - Dubai Expat staff', amount: 126.0, expense_id: 1 },
      { txn_id: 9002, maid_id: null, date: '2026-06-05', expense_name: 'NEW - OfficeStaff - ILOE Subscription', amount: 126.0, expense_id: 2 },
    ],
    loans_by_maid: {},
  },
  { noCases: true, excludedCount: 2 });

t('GUARD — a retired-era expense name never enters a current-period run',
  {
    audited_month: '2026-06',
    payments: [{ txn_id: 9003, maid_id: 111, date: '2026-06-05', expense_name: 'NEW - ILOE Mandatory Insurance - MV Maids', amount: 126.0, expense_id: 1157 }],
    loans_by_maid: { '111': [] },
  },
  { noCases: true, excludedCount: 1 });

t('GUARD — an unrecognised ILOE-shaped name is pending, never clean and never dropped',
  {
    audited_month: '2026-06',
    payments: [{ txn_id: 9004, maid_id: 112, date: '2026-06-05', expense_name: 'NEW - XX Housemaids - ILOE Subscription', amount: 126.0, expense_id: 9999 }],
    loans_by_maid: { '112': [] },
  },
  { noCases: true, excludedCount: 1 });

t('GUARD — unresolved maid is pending, never clean (recovery 0 must not read as clean)',
  {
    audited_month: '2026-06',
    payments: [pay(9005, null, '2026-06-05', SUB_MV_NEW, 126.0)],
    loans_by_maid: {},
  },
  { verdict: 'pending', label: 'Unresolved maid', finding_aed: 0, fired: 'G11' });

t('GUARD — an unreadable loans call is pending, never a finding (outage must not manufacture a red)',
  {
    audited_month: '2026-06',
    payments: [pay(9006, 113, '2026-06-05', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '113': null },
  },
  { verdict: 'pending', label: 'Unresolved maid', finding_aed: 0, reasonHas: 'loans_call_unreadable' });

t('GUARD — a FINES payment is never compared against a PLAN loan',
  {
    audited_month: '2026-06',
    payments: [pay(9007, 114, '2026-06-10', FINES_MV_NEW, 402.86, 1692)],
    loans_by_maid: { '114': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00')] },
  },
  { verdict: 'finding', label: 'ILOE not recovered', finding_aed: 402.86, fired: 'G5' });

t('GUARD — a FINES payment matched by a FINES loan is clean',
  {
    audited_month: '2026-06',
    payments: [pay(9008, 115, '2026-06-10', FINES_MV_NEW, 402.86, 1692)],
    loans_by_maid: { '115': [loan('UNEMPLOYMENT_INSURANCE_FINES', 402.86, '2026-06-10 10:00:00')] },
  },
  { verdict: 'clean', label: 'Recovered', finding_aed: 0, fired: 'G10' });

t('GUARD — retired PREMIUM loan type is NOT accepted as recovery on a current run',
  {
    audited_month: '2026-06',
    payments: [pay(9009, 116, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '116': [loan('UNEMPLOYMENT_INSURANCE_PREMIUM', 126.0, '2026-06-10 10:00:00')] },
  },
  { verdict: 'finding', label: 'ILOE not recovered', finding_aed: 126.0, fired: 'G5' });

t('GUARD — a loan outside the −30/+60 window does not count as recovery',
  {
    audited_month: '2026-06',
    payments: [pay(9010, 117, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '117': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-01-01 10:00:00')] },
  },
  { verdict: 'finding', label: 'ILOE not recovered', finding_aed: 126.0, fired: 'G5' });

t('GUARD — the mirror case (loan exceeds payment) is clean, never a finding',
  {
    audited_month: '2026-06',
    payments: [pay(9011, 118, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: {
      '118': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-05-20 10:00:00'),
      ],
    },
  },
  { verdict: 'clean', label: 'Recovered', finding_aed: 0, fired: 'G10' });

t('GUARD — the 0.50 tolerance is absolute: a 0.40 gap is clean, a 1.26 gap is short',
  {
    audited_month: '2026-06',
    payments: [
      pay(9012, 119, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9013, 120, '2026-06-10', SUB_MV_NEW, 126.0),
    ],
    loans_by_maid: {
      '119': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 125.6, '2026-06-10 10:00:00')],
      '120': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 124.74, '2026-06-10 10:00:00')],
    },
  },
  { multi: [{ txn: 9012, verdict: 'clean' }, { txn: 9013, verdict: 'finding' }] });

t('GUARD — +126 +126 −126 same day nets to one unit: no duplicate, no excess',
  {
    audited_month: '2026-06',
    payments: [
      pay(9014, 121, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9015, 121, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9016, 121, '2026-06-10', SUB_MV_NEW, -126.0),
    ],
    loans_by_maid: { '121': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00')] },
  },
  { noneAre: 'finding' });

t('GUARD — NEW and RENEW for one maid are never netted or counted together',
  {
    audited_month: '2026-06',
    payments: [
      pay(9017, 122, '2026-06-10', SUB_MV_NEW, 126.0, 1693),
      pay(9018, 122, '2026-06-12', SUB_MV_RENEW, 126.0, 1727),
    ],
    loans_by_maid: {
      '122': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-12 10:00:00'),
      ],
    },
  },
  { noneAre: 'finding' });

t('GUARD — a subscription and a fine in one month are two obligations, not a duplicate',
  {
    audited_month: '2026-06',
    payments: [
      pay(9019, 123, '2026-06-10', SUB_MV_NEW, 126.0, 1693),
      pay(9020, 123, '2026-06-12', FINES_MV_NEW, 402.86, 1692),
    ],
    loans_by_maid: {
      '123': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00'),
        loan('UNEMPLOYMENT_INSURANCE_FINES', 402.86, '2026-06-12 10:00:00'),
      ],
    },
  },
  { noneAre: 'finding' });

t('GUARD — a waiver with an empty note is a finding, not a clean (verifier 3)',
  {
    audited_month: '2026-06',
    payments: [pay(9021, 124, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '124': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00', 126.0, '', 'Paid')] },
  },
  { verdict: 'finding', label: 'Written off with no authority', finding_aed: 126.0, fired: 'V3' });

t('GUARD — a bare "waived" note names neither approver nor reason → finding (verifier 3)',
  {
    audited_month: '2026-06',
    payments: [pay(9022, 125, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: { '125': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00', 126.0, 'waived', 'Paid')] },
  },
  { verdict: 'finding', label: 'Written off with no authority', finding_aed: 126.0, fired: 'V3' });

t('GUARD — an unseen waiver reason is pending, never auto-cleared (ruling R3 open)',
  {
    audited_month: '2026-06',
    payments: [pay(9023, 126, '2026-06-10', SUB_MV_NEW, 126.0)],
    loans_by_maid: {
      '126': [loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00', 126.0,
                   '126 AED were waived by A Staff Member on 26/06/2026 because Goodwill', 'Paid')],
    },
  },
  { verdict: 'pending', reasonHas: 'unseen_waiver_reason' });

t('GUARD — a waiver must NOT clean a duplicate on the same maid (the ~150x enrichment case)',
  {
    audited_month: '2026-06',
    payments: [
      pay(9024, 127, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9025, 127, '2026-06-10', SUB_MV_NEW, 126.0),
    ],
    loans_by_maid: {
      '127': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:01:00', 2.0,
             '2 AED were waived by A Staff Member on 11/07/2026 because Duplicate', 'Paid'),
      ],
    },
  },
  { anyIs: 'finding', anyLabel: 'ILOE paid twice' });

t('GUARD — a zero-amount row is pending, never compared and never cleaned',
  {
    audited_month: '2026-06',
    payments: [pay(9026, 128, '2026-06-10', SUB_MV_NEW, 0)],
    loans_by_maid: { '128': [] },
  },
  { verdict: 'pending', reasonHas: 'txn_amount_zero' });

t('GUARD — a zero-amount fine row beside a real fine nets correctly, not to "reversed"',
  {
    audited_month: '2026-06',
    payments: [
      pay(9030, 130, '2026-06-10', FINES_MV_NEW, 402.86, 1692),
      pay(9031, 130, '2026-06-10', FINES_MV_NEW, 0, 1692),
    ],
    loans_by_maid: { '130': [loan('UNEMPLOYMENT_INSURANCE_FINES', 402.86, '2026-06-10 10:00:00')] },
  },
  { noneAre: 'finding' });

t('GUARD — a duplicate group yields ONE excess, not one per payment',
  {
    audited_month: '2026-06',
    payments: [
      pay(9027, 129, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9028, 129, '2026-06-10', SUB_MV_NEW, 126.0),
      pay(9029, 129, '2026-06-11', SUB_MV_NEW, 126.0),
    ],
    loans_by_maid: {
      '129': [
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:00:00'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-10 10:01:00'),
        loan('UNEMPLOYMENT_INSURANCE_PLAN', 126.0, '2026-06-11 10:00:00'),
      ],
    },
  },
  { totalFindingAed: 252.0, findingCount: 1 });

module.exports = { tests: tests, S: S };
