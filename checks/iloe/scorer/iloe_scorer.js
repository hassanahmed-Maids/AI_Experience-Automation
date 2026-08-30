'use strict';

/**
 * ILOE Checker — deterministic scorer + verifier layer.
 *
 * Pure function. No I/O, no ERP calls. Drops into an n8n Code node unchanged.
 * Implements the 12 deterministic gates and 5 verifier rules of ILOE Checker
 * spec v0.8, in ACP Order.
 *
 * Money is handled in integer cents throughout. Float dirhams are converted
 * once at the boundary and never compared directly.
 */

const TOL_CENTS = 50;                 // AED 0.50 absolute. Never a percentage (gate 7).
const LOAN_WINDOW_BEFORE_DAYS = 30;   // gate 4
const LOAN_WINDOW_AFTER_DAYS = 60;    // gate 4

// Gate 1 — the six live expense heads. Ids are exact; names are what the
// search returns. Both are carried because the id filter is exact and the
// name filter is what the endpoint reliably accepts.
const LIVE_EXPENSES = {
  1693: 'NEW - MV Housemaids - ILOE Subscription',
  1692: 'NEW - MV Housemaids - ILOE Fines',
  1605: 'NEW - CC Housemaids - ILOE Subscription',
  1604: 'NEW - CC Housemaids - ILOE Fines',
  1727: 'RENEW - MV Housemaids - ILOE Subscription',
  1639: 'RENEW - CC Housemaids - ILOE Subscription',
};

const LIVE_NAMES = new Set(Object.keys(LIVE_EXPENSES).map(function (k) { return LIVE_EXPENSES[k]; }));

// Excluded at the population gate: 0 of 87 staff rows carry a housemaid id.
const STAFF_NAMES = new Set([
  'ILOE Mandatory Insurance - Dubai Expat staff',
  'NEW - OfficeStaff - ILOE Subscription',
]);

// Retired 2025-12-18. Never valid for a current-period run. Present so a
// retired-era name is named as such rather than falling into "unknown".
const RETIRED_NAMES = new Set([
  'NEW - ILOE Mandatory Insurance - MV Maids',
  'NEW - ILOE Mandatory Insurance - CC Maids',
  'Renewal and Cancellation - ILOE Mandatory Insurance - MV Maids',
  'Renewal and Cancellation - ILOE Mandatory Insurance - CC Maids',
]);

// Gate 4 — the recovery loan types, by family. UNEMPLOYMENT_INSURANCE_PREMIUM
// is retired (last row 2025-03-02) and is deliberately NOT accepted on a
// current-period run.
const LOAN_TYPE_FOR_FAMILY = {
  SUBSCRIPTION: 'UNEMPLOYMENT_INSURANCE_PLAN',
  FINES: 'UNEMPLOYMENT_INSURANCE_FINES',
};

const KNOWN_UNEMPLOYMENT_TYPES = new Set([
  'UNEMPLOYMENT_INSURANCE_PLAN',
  'UNEMPLOYMENT_INSURANCE_FINES',
  'UNEMPLOYMENT_INSURANCE_PREMIUM',
]);

// Verifier 2 — the reasons observed live on 2026-08-20. An unseen reason is
// NOT auto-cleared: it routes to the verifier floor, on the same
// "an unseen member routes, never cleans" discipline the rest of the spec uses.
// Which reasons are acceptable is ruling R3, and it is unanswered.
const OBSERVED_WAIVER_REASONS = new Set(['escalation', 'duplicate']);

// waiveNotes is auto-generated from a fixed template, confirmed live 2026-08-20:
//   "<amount> AED were waived by <full name> on <DD/MM/YYYY> because <reason>"
const WAIVE_NOTE_RE = /waived\s+by\s+(.+?)\s+on\s+(\d{2}\/\d{2}\/\d{4})\s+because\s+(.+?)\s*$/i;

// ---------------------------------------------------------------- helpers

function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToAed(c) {
  return Math.round(c) / 100;
}

/** Parses "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" to a UTC day number. */
function toDayNumber(v) {
  if (typeof v !== 'string' || v.length < 10) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Gate 3 — the expense family. Never taken from the transaction description. */
function familyOf(expenseName) {
  return /ILOE Fines/i.test(expenseName) ? 'FINES' : 'SUBSCRIPTION';
}

/** NEW vs RENEW, from the expense-name prefix. Used to partition groups. */
function stageOf(expenseName) {
  if (/^RENEW\s*-/i.test(expenseName)) return 'RENEW';
  if (/^NEW\s*-/i.test(expenseName)) return 'NEW';
  return 'UNKNOWN';
}

/**
 * The maid's type AT THE MOMENT OF PAYMENT — derived from the expense name,
 * never read off her current profile, because maids switch between CC and MV.
 */
function maidTypeOf(expenseName) {
  if (/MV Housemaids|MV Maids/i.test(expenseName)) return 'MV';
  if (/CC Housemaids|CC Maids/i.test(expenseName)) return 'CC';
  return 'OTHER';
}

function groupKey(maidId, family, stage) {
  return maidId + '|' + family + '|' + stage;
}

// ---------------------------------------------------------------- gate 1

/**
 * Gate 1 — population. Classifies one raw search row.
 * Returns { admit, disposition, reason }.
 */
function classifyPopulationRow(row) {
  const name = row.expense_name;
  if (typeof name !== 'string' || name === '') {
    return { admit: false, disposition: 'pending', reason: 'expense_name_missing' };
  }
  if (STAFF_NAMES.has(name)) {
    return { admit: false, disposition: 'excluded', reason: 'staff_expense_out_of_scope' };
  }
  if (RETIRED_NAMES.has(name)) {
    return { admit: false, disposition: 'excluded', reason: 'retired_era_expense_name' };
  }
  if (!LIVE_NAMES.has(name)) {
    // Deliberately open-ended: an unseen ILOE-shaped name is never cleaned
    // and never silently dropped.
    return { admit: false, disposition: 'pending', reason: 'unrecognised_expense_name:' + name };
  }
  if (toDayNumber(row.date) === null) {
    return { admit: false, disposition: 'pending', reason: 'txn_date_missing_or_unparseable' };
  }
  const cents = toCents(row.amount);
  if (cents === null) {
    return { admit: false, disposition: 'pending', reason: 'txn_amount_missing' };
  }
  return { admit: true, disposition: 'in_scope', reason: null };
}

// ---------------------------------------------------------------- gate 12

/**
 * Gate 12 — net the group before anything is compared.
 *
 * "The single-unit price" is taken as the LARGEST POSITIVE payment in the
 * group, not a hard-coded tariff: gate 3 forbids treating 402.86 as an
 * expected fine, and fine amounts carry 14 distinct observed values.
 * This reproduces every documented case (see spec-corrections.md).
 */
function netGroup(payments) {
  let net = 0;
  let unit = 0;
  let positives = 0;
  for (let i = 0; i < payments.length; i++) {
    const c = payments[i].amount_cents;
    net += c;
    if (c > 0) {
      positives += 1;
      if (c > unit) unit = c;
    }
  }
  return { net_cents: net, unit_cents: unit, positive_count: positives, txn_count: payments.length };
}

// ---------------------------------------------------------------- gate 4

/**
 * Gate 4 — recovery is the matching-type loan on the resolved maid, inside
 * the payment's window.
 *
 * Compares on `amount` (the principal) — this check asks whether the debt was
 * RAISED, not whether it has been collected. waivedAmount is never netted off.
 */
function computeRecovery(loans, family, txnDayNumber) {
  const wanted = LOAN_TYPE_FOR_FAMILY[family];
  const lo = txnDayNumber - LOAN_WINDOW_BEFORE_DAYS;
  const hi = txnDayNumber + LOAN_WINDOW_AFTER_DAYS;

  let recovery = 0;
  const matched = [];
  const unseenTypes = [];

  for (let i = 0; i < loans.length; i++) {
    const ln = loans[i];
    const t = ln.loanType;
    if (typeof t !== 'string') continue;
    if (t.indexOf('UNEMPLOYMENT') !== 0) continue;           // 43 other types are out of scope
    if (!KNOWN_UNEMPLOYMENT_TYPES.has(t)) {
      unseenTypes.push(t);                                    // gate 11 will park the case
      continue;
    }
    if (t !== wanted) continue;                               // never merge FINES into SUBSCRIPTION
    const day = toDayNumber(ln.loanDate);
    if (day === null) continue;
    if (day < lo || day > hi) continue;                       // never pair on type alone
    const amt = toCents(ln.amount);
    if (amt === null) continue;
    recovery += amt;
    matched.push(ln);
  }

  return { recovery_cents: recovery, matched: matched, unseen_types: unseenTypes };
}

// ---------------------------------------------------------------- verifier

/**
 * Verifier 2 / 3 — read the note itself, never a summary of it.
 * Returns { hasApprover, hasReason, approver, reason, raw }.
 */
function parseWaiveNote(note) {
  const raw = typeof note === 'string' ? note.trim() : '';
  if (raw === '') return { hasApprover: false, hasReason: false, approver: null, reason: null, raw: '' };
  const m = WAIVE_NOTE_RE.exec(raw);
  if (!m) return { hasApprover: false, hasReason: false, approver: null, reason: null, raw: raw };
  const approver = (m[1] || '').trim();
  const reason = (m[3] || '').trim();
  return {
    hasApprover: approver.length > 0,
    hasReason: reason.length > 0,
    approver: approver.length > 0 ? approver : null,
    reason: reason.length > 0 ? reason : null,
    raw: raw,
  };
}

// ---------------------------------------------------------------- scoring

/**
 * scoreRun(input) -> { cases, run }
 *
 * input = {
 *   audited_month: 'YYYY-MM',
 *   payments: [{ txn_id, expense_id, expense_name, amount, date, maid_id, identity_error }],
 *   loans_by_maid: { '<maid_id>': [loanRow] | null }   // null == the loans call FAILED
 * }
 *
 * `payments` must include the netting lookahead window (audited month plus the
 * following 60 days) so a late reversal is visible. Only payments whose date
 * falls inside `audited_month` become cases.
 */
function scoreRun(input) {
  const auditedMonth = input.audited_month;
  const rawPayments = input.payments || [];
  const loansByMaid = input.loans_by_maid || {};

  const cases = [];
  const excluded = [];

  // ---- gate 1: population -------------------------------------------------
  const admitted = [];
  for (let i = 0; i < rawPayments.length; i++) {
    const row = rawPayments[i];
    const cls = classifyPopulationRow(row);
    const inMonth = typeof row.date === 'string' && row.date.slice(0, 7) === auditedMonth;

    if (!cls.admit) {
      if (inMonth) excluded.push({ txn_id: row.txn_id, disposition: cls.disposition, reason: cls.reason });
      continue;
    }
    admitted.push({
      txn_id: row.txn_id,
      expense_id: row.expense_id,
      expense_name: row.expense_name,
      amount_cents: toCents(row.amount),
      date: row.date,
      day: toDayNumber(row.date),
      in_audited_month: inMonth,
      maid_id: row.maid_id === undefined ? null : row.maid_id,
      identity_error: row.identity_error || null,
      family: familyOf(row.expense_name),
      stage: stageOf(row.expense_name),
      maid_type: maidTypeOf(row.expense_name),
    });
  }

  // ---- gate 12: net the groups (over the full lookahead window) ------------
  const groups = {};
  for (let i = 0; i < admitted.length; i++) {
    const p = admitted[i];
    if (p.maid_id === null || p.maid_id === undefined) continue;   // gate 2 parks these
    const k = groupKey(p.maid_id, p.family, p.stage);
    if (!groups[k]) groups[k] = [];
    groups[k].push(p);
  }
  const groupNet = {};
  const groupKeys = Object.keys(groups);
  for (let i = 0; i < groupKeys.length; i++) {
    groupNet[groupKeys[i]] = netGroup(groups[groupKeys[i]]);
  }

  // Gate 9 attributes the NET EXCESS once per group, to the highest txn_id in
  // that group, so a two-payment duplicate yields one excess, not two.
  const duplicateOwner = {};
  for (let i = 0; i < groupKeys.length; i++) {
    const k = groupKeys[i];
    const g = groupNet[k];
    const isDuplicate = g.txn_count > 1 && g.net_cents > g.unit_cents + TOL_CENTS;
    if (!isDuplicate) continue;
    let owner = null;
    const members = groups[k];
    for (let j = 0; j < members.length; j++) {
      if (!members[j].in_audited_month) continue;
      if (owner === null || String(members[j].txn_id) > String(owner)) owner = members[j].txn_id;
    }
    if (owner !== null) duplicateOwner[k] = { txn_id: owner, excess_cents: g.net_cents - g.unit_cents };
  }

  // ---- per-case scoring ---------------------------------------------------
  for (let i = 0; i < admitted.length; i++) {
    const p = admitted[i];
    if (!p.in_audited_month) continue;   // lookahead rows exist only for netting

    const c = {
      txn_id: p.txn_id,
      maid_id: p.maid_id,
      maid_type: p.maid_type,
      family: p.family,
      stage: p.stage,
      expense_id: p.expense_id,
      expense_name: p.expense_name,
      txn_date: p.date,
      paid_aed: centsToAed(p.amount_cents),
      recovery_aed: null,
      waived_aed: null,
      group_net_aed: null,
      group_unit_aed: null,
      group_txn_count: null,
      loan_status: null,
      verdict: null,
      verdict_label: null,
      finding_aed: 0,
      unrecovered_aed: 0,
      duplicate_excess_aed: 0,
      shortfall_aed: 0,
      rules_fired: [],
      reasons: [],
      verifier_records: [],
    };

    // -- gate 2: identity resolution before anything else -------------------
    if (p.maid_id === null || p.maid_id === undefined) {
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      c.rules_fired.push('G11');
      c.reasons.push(p.identity_error ? 'identity_call_failed' : 'maid_unresolved_on_transaction');
      cases.push(c);
      continue;
    }

    if (p.maid_type === 'OTHER') {
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      c.rules_fired.push('G11');
      c.reasons.push('maid_type_other');
      cases.push(c);
      continue;
    }

    // A zero-amount row is parked with its own reason, never compared and
    // never cleaned. It still participates in group netting above (adding
    // zero changes nothing), so a fine beside a zero row nets correctly.
    if (p.amount_cents === 0) {
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      c.rules_fired.push('G11');
      c.reasons.push('txn_amount_zero');
      cases.push(c);
      continue;
    }

    const k = groupKey(p.maid_id, p.family, p.stage);
    const g = groupNet[k];
    c.group_net_aed = centsToAed(g.net_cents);
    c.group_unit_aed = centsToAed(g.unit_cents);
    c.group_txn_count = g.txn_count;

    // -- gate 12: a reversed payment was never a cost -----------------------
    if (g.net_cents < 0) {
      c.verdict = 'pending';
      c.verdict_label = 'Reversed, out of scope';
      c.rules_fired.push('G12', 'G11');
      c.reasons.push('netting_failed_negative_net');
      cases.push(c);
      continue;
    }
    if (g.net_cents === 0) {
      c.verdict = 'pending';
      c.verdict_label = 'Reversed, out of scope';
      c.rules_fired.push('G12', 'G11');
      c.reasons.push('reversed');
      cases.push(c);
      continue;
    }

    // -- gate 4: recovery ---------------------------------------------------
    const loans = loansByMaid[String(p.maid_id)];
    if (loans === null || loans === undefined) {
      // An unreadable loans call is PENDING, never a finding and never clean.
      // Defaulting a missing input to zero here would manufacture a red.
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      c.rules_fired.push('G11');
      c.reasons.push('loans_call_unreadable');
      cases.push(c);
      continue;
    }

    const rec = computeRecovery(loans, p.family, p.day);
    c.recovery_aed = centsToAed(rec.recovery_cents);

    if (rec.unseen_types.length > 0) {
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      c.rules_fired.push('G11');
      c.reasons.push('unseen_unemployment_loan_type:' + rec.unseen_types.join(','));
      cases.push(c);
      continue;
    }

    let waivedTotal = 0;
    for (let j = 0; j < rec.matched.length; j++) {
      const w = toCents(rec.matched[j].waivedAmount);
      if (w !== null && w > 0) waivedTotal += w;
    }
    c.waived_aed = centsToAed(waivedTotal);
    c.loan_status = rec.matched.length ? rec.matched.map(function (l) { return l.status; }).join('|') : null;

    const dup = duplicateOwner[k];
    const groupIsDuplicate = !!dup;
    const ownsDuplicate = groupIsDuplicate && String(dup.txn_id) === String(p.txn_id);

    // -- gates 5,6,7,8,9,10 -------------------------------------------------
    // Evaluated in ACP Order. Routing gates (6, 8) do not stop later gates:
    // gate 9 must still be able to raise a duplicate on a waived maid, and a
    // case-scoped clean at verifier 2 must not erase it.
    const reds = [];
    let routedToVerifier = false;

    // Gate 5 — MV with no matching loan.
    if (p.maid_type === 'MV' && rec.recovery_cents === 0) {
      c.rules_fired.push('G5');
      c.unrecovered_aed = centsToAed(p.amount_cents);
      reds.push({ rule: 'G5', label: 'ILOE not recovered', cents: p.amount_cents });
    }

    // Gate 6 — CC with no matching loan. Routes; never red, never clean.
    if (p.maid_type === 'CC' && rec.recovery_cents === 0) {
      c.rules_fired.push('G6');
      routedToVerifier = true;
      c.verifier_records.push({ kind: 'cc_unrecovered', amount_aed: centsToAed(p.amount_cents) });
    }

    // Gate 7 — a loan short of the payment. Never the mirror case.
    if (rec.recovery_cents > 0 && rec.recovery_cents + TOL_CENTS < p.amount_cents) {
      c.rules_fired.push('G7');
      c.shortfall_aed = centsToAed(p.amount_cents - rec.recovery_cents);
      reds.push({ rule: 'G7', label: 'ILOE short', cents: p.amount_cents - rec.recovery_cents });
    }

    // Gate 8 — a waived loan is not a recovered loan. Routes for a read.
    if (waivedTotal > 0) {
      c.rules_fired.push('G8');
      routedToVerifier = true;
      for (let j = 0; j < rec.matched.length; j++) {
        const w = toCents(rec.matched[j].waivedAmount);
        if (w !== null && w > 0) {
          c.verifier_records.push({
            kind: 'waiver',
            loan_id: rec.matched[j].id === undefined ? null : rec.matched[j].id,
            waived_aed: centsToAed(w),
            note: rec.matched[j].waiveNotes || '',
          });
        }
      }
    }

    // Gate 9 — paid twice. Runs AFTER gate 12 has netted reversals.
    // EVERY payment in a duplicate group is red, not just the one carrying the
    // excess. Marking only the owner let the sibling fall through to verifier 2
    // and be cleaned by an unrelated waiver on the same maid — the exact failure
    // verifier 2's own Never line names, found on the built flow 2026-08-30.
    // The excess is still attributed once, so the money total does not inflate.
    if (groupIsDuplicate) {
      c.rules_fired.push('G9');
      c.duplicate_excess_aed = ownsDuplicate ? centsToAed(dup.excess_cents) : 0;
      reds.push({ rule: 'G9', label: 'ILOE paid twice', cents: ownsDuplicate ? dup.excess_cents : 0 });
    }

    // Gate 10 — clean. Guarded against both the waiver gate and gate 9.
    const cleanEligible =
      rec.recovery_cents + TOL_CENTS >= p.amount_cents &&
      waivedTotal === 0 &&
      !groupIsDuplicate;

    // -- verifier layer -----------------------------------------------------
    const verifierVerdicts = [];
    if (routedToVerifier) {
      for (let j = 0; j < c.verifier_records.length; j++) {
        const vr = c.verifier_records[j];

        if (vr.kind === 'cc_unrecovered') {
          // Verifier 1 — pending until ruling R1 is answered.
          verifierVerdicts.push({ rule: 'V1', verdict: 'pending', label: 'Awaiting the CC ruling', cents: 0 });
          continue;
        }

        const parsed = parseWaiveNote(vr.note);
        vr.approver_present = parsed.hasApprover;
        vr.reason = parsed.reason;

        if (!parsed.hasApprover || !parsed.hasReason) {
          // Verifier 3 — a write-off with no recorded authority.
          verifierVerdicts.push({
            rule: 'V3', verdict: 'finding', label: 'Written off with no authority',
            cents: toCents(vr.waived_aed),
          });
        } else if (!OBSERVED_WAIVER_REASONS.has(String(parsed.reason).toLowerCase())) {
          // An unseen reason is not auto-cleared. Which reasons are acceptable
          // is ruling R3, and it is unanswered.
          verifierVerdicts.push({
            rule: 'V4', verdict: 'pending', label: 'Awaiting the CC ruling',
            cents: 0, reason: 'unseen_waiver_reason:' + parsed.reason,
          });
        } else {
          // Verifier 2 — clean (explained), scoped to THIS loan record only.
          verifierVerdicts.push({ rule: 'V2', verdict: 'clean', label: 'Written off with authority', cents: 0 });
        }
      }
      if (verifierVerdicts.length === 0) {
        verifierVerdicts.push({ rule: 'V4', verdict: 'pending', label: 'Awaiting the CC ruling', cents: 0 });
      }
    }

    for (let j = 0; j < verifierVerdicts.length; j++) {
      const vv = verifierVerdicts[j];
      c.rules_fired.push(vv.rule);
      if (vv.verdict === 'finding') reds.push({ rule: vv.rule, label: vv.label, cents: vv.cents || 0 });
      if (vv.reason) c.reasons.push(vv.reason);
    }

    // -- resolve the case verdict: the worst surviving record ---------------
    if (reds.length > 0) {
      c.verdict = 'finding';
      // Components are reported separately and the headline is the LARGEST of
      // them, never their sum: gate 5's "the whole payment did not come back"
      // and gate 9's "we paid this twice" can describe the same dirhams.
      let best = reds[0];
      for (let j = 1; j < reds.length; j++) if (reds[j].cents > best.cents) best = reds[j];
      c.finding_aed = centsToAed(best.cents);
      c.verdict_label = best.label;
      const labels = [];
      for (let j = 0; j < reds.length; j++) labels.push(reds[j].label);
      if (labels.length > 1) c.reasons.push('multiple_reds:' + labels.join(' + '));
    } else if (routedToVerifier) {
      let anyPending = false;
      for (let j = 0; j < verifierVerdicts.length; j++) if (verifierVerdicts[j].verdict === 'pending') anyPending = true;
      if (anyPending) {
        c.verdict = 'pending';
        c.verdict_label = 'Awaiting the CC ruling';
      } else {
        c.verdict = 'clean';
        c.verdict_label = 'Written off with authority';
      }
    } else if (cleanEligible) {
      c.rules_fired.push('G10');
      c.verdict = 'clean';
      c.verdict_label = 'Recovered';
    } else {
      // Gate 11 — the deterministic floor. Silence never means clean.
      c.rules_fired.push('G11');
      c.verdict = 'pending';
      c.verdict_label = 'Unresolved maid';
      if (c.reasons.length === 0) c.reasons.push('no_gate_concluded');
    }

    cases.push(c);
  }

  // ---- run roll-up (counts, flags and totals only) ------------------------
  const run = {
    audited_month: auditedMonth,
    n_cases: cases.length,
    n_findings: 0,
    n_clean: 0,
    n_pending: 0,
    n_excluded: excluded.length,
    total_finding_aed: 0,
    // A duplicate group of two payments produces two red CASES but one excess.
    // Both numbers are reported so "6 payments" is never read as "6 duplicates".
    n_duplicate_groups: Object.keys(duplicateOwner).length,
    by_label: {},
    by_rule: {},
  };
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.verdict === 'finding') { run.n_findings += 1; run.total_finding_aed += c.finding_aed; }
    else if (c.verdict === 'clean') run.n_clean += 1;
    else run.n_pending += 1;
    run.by_label[c.verdict_label] = (run.by_label[c.verdict_label] || 0) + 1;
    for (let j = 0; j < c.rules_fired.length; j++) {
      run.by_rule[c.rules_fired[j]] = (run.by_rule[c.rules_fired[j]] || 0) + 1;
    }
  }
  run.total_finding_aed = Math.round(run.total_finding_aed * 100) / 100;

  return { cases: cases, run: run, excluded: excluded };
}

module.exports = {
  scoreRun,
  classifyPopulationRow,
  netGroup,
  computeRecovery,
  parseWaiveNote,
  familyOf,
  stageOf,
  maidTypeOf,
  toCents,
  LIVE_EXPENSES,
  LIVE_NAMES,
  STAFF_NAMES,
  TOL_CENTS,
};
