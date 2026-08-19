'use strict';

// MV Monthly Payment check — deterministic scorer.
// Spec: Notion "MV Monthly Payment check" v0.8, 17 deterministic gates + 5 verifier rules.
// Built standalone so it can be tested offline against the spec's own test cases before
// it goes near n8n. Every gate below cites its numeral and Order.

const COLLECTED = 'RECEIVED';
const DEAD = ['BOUNCED', 'DELETED'];
const IN_FLIGHT_KNOWN = ['PDC', 'PRE_PDP'];
const MONTHLY = 'monthly_payment';

// Known payment-type codes. Deliberately OPEN-ENDED per gate 10's Never: an
// unrecognised type is a red flag, not a silent exclusion. This list is the set we
// recognise, NOT a whitelist that closes the month.
const KNOWN_TYPE_CODES = [
  'monthly_payment', 'monthly_payment_add_on', 'pre_collected_payment',
  'pre_collected_payment_no_vat', 'transfer_fee', 'same_day_recruitment_fee',
  'visa_2_years', 'wps_processing_fee', 'gcc_fee', 'overstay_fine',
  'travel_visa_lebanon', 'travel_visa_egypt', 'travel_assist_fee',
  'second_year_insurance', 'refund',
];

const VERDICT = {
  CLEAN: 'clean',
  CLEAN_VIP: 'clean-vip-exception',
  RED: 'finding',
  PENDING: 'pending',
  INCONCLUSIVE: 'inconclusive',
};

const RED_TYPE = {
  MISSING_1ST: 'missing 1st-of-month payment',
  MISSING_PREV: 'missing previous-month payment',
  AMOUNT: 'payment amount mismatch',
  BAD_TYPE: 'missing or invalid payment type',
};

function monthKey(d) {
  if (d === null || d === undefined || d === '') return null;
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : null;
}

function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

// preCollectedInfo amounts are FORMATTED STRINGS ("AED 1,743"). A naive float() throws.
function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Money comparison at fils precision. Gate 17: no tolerance is applied — expected is the
// plan's own amount, so a 1-fil gap flags loud rather than failing silent.
function cmpMoney(a, b) {
  const d = Math.round((a - b) * 100);
  return d === 0 ? 0 : (d > 0 ? 1 : -1);
}

// Gate 9 (Order 180) + Gate 11 (Order 200): the expected amount.
// The split lives on currentPayments[] — PLURAL. currentPayment (singular) is a display
// summary. A null split means expectation UNKNOWN, never zero.
function deriveExpected(contract) {
  const singular = parseMoney(contract && contract.currentPayment && contract.currentPayment.amountValue);
  const rows = (contract && Array.isArray(contract.currentPayments)) ? contract.currentPayments : [];

  // The monthly row of the plan snapshot. Gate 12: one-off / biennial lines are excluded
  // from both sides of the comparison.
  const monthlyRows = rows.filter(function (r) {
    const code = r && r.paymentTypeCode;
    return code === MONTHLY || code === 'pre_collected_payment' || code === 'pre_collected_payment_no_vat';
  });
  const row = monthlyRows.length ? monthlyRows[0] : null;

  let split = null;
  if (row) {
    const salary = parseMoney(row.workerSalary);
    const fees = parseMoney(row.visaFees);
    // Gate 9's Never: never default a missing split to zero. On terminated contract
    // 1053569 all three money fields come back null; zeroing makes the expectation the
    // fee alone and manufactures a large false shortfall.
    if (isNum(salary) && isNum(fees)) split = salary + fees;
  }

  let expected = null;
  let source = null;
  if (isNum(split)) {
    expected = split;
    source = 'currentPayments[].workerSalary + visaFees';
  } else if (isNum(singular)) {
    expected = singular;
    source = 'currentPayment.amountValue';
  }

  // Cross-check, not an override. Verified live on 4 active MV contracts that
  // workerSalary + visaFees == amountValue exactly.
  let crossCheckOk = null;
  if (isNum(split) && isNum(singular)) crossCheckOk = cmpMoney(split, singular) === 0;

  return { expected: expected, source: source, split: split, singular: singular, crossCheckOk: crossCheckOk };
}

// Gate 2 (Order 110): the audited month must fall inside the contract's own life.
function monthInContractLife(contract, mk) {
  const start = monthKey(contract && contract.startDate);
  // Never drop a month because the end date could not be read. An empty or unreadable
  // end date keeps the month in scope.
  const end = monthKey(
    (contract && contract.dateOfTermination) ||
    (contract && contract.isScheduledForTermination ? contract.scheduledDateOfTermination : null)
  );
  if (start && mk < start) return { inLife: false, why: 'month precedes contract start' };
  if (end && mk > end) return { inLife: false, why: 'month follows contract termination' };
  return { inLife: true, isStartMonth: !!(start && start === mk) };
}

// Gate 5 (Order 140): Pre-Collected. It is an exception PATH, not an exemption.
//
// SPEC CONTRADICTION — resolved conservatively, see DEVIATIONS.md.
// The rule body says the month under test becomes the PREVIOUS month. The spec's own test
// cases 3 and 5 score contract 1099709 (which reads isPreCollectedSalary = true) against
// each month's OWN ledger rows with no shift. Applying the shift literally makes case 3
// test May 2026 — before the 26 Jun contract start — which turns a clean month into either
// no case or a false red, depending on gate order.
//
// Taken: score the audited month on its own rows. Where such a month is UNSETTLED and the
// contract is pre-collected, do not conclude a red — route it to the verifier with the
// advance attached. That avoids the false red the literal shift produces AND the false
// clearance that treating the previous month's money as covering this one would produce.
function resolvePreCollected(contract) {
  const pc = contract && contract.preCollectedInfo;
  const flag = pc ? pc.isPreCollectedSalary : undefined;
  // Gate 4's Never: never treat an unreadable is_pre_collected as false. Unknown halts
  // the case; defaulting to false runs the red gate against a Pre-Collected contract.
  if (flag === undefined || flag === null) {
    return { isPreCollected: null, unknown: true, advanceReceived: null, advanceEntries: 0 };
  }
  // The advance array carries DEAD ROWS — presence is not money. Contract 1053569 returns
  // the same 2,400 twice, once RECEIVED and once BOUNCED. Sum the RECEIVED entries only,
  // and never trust precollectedAmount, which mirrors the first entry.
  const entries = (pc && Array.isArray(pc.currentPreCollectedPayments)) ? pc.currentPreCollectedPayments : [];
  let advance = 0;
  for (const e of entries) {
    if (!e || e.status !== COLLECTED) continue;
    const amt = parseMoney(e.amount);
    if (isNum(amt)) advance += amt;
  }
  return {
    isPreCollected: flag === true,
    unknown: false,
    advanceReceived: entries.length ? advance : null,
    advanceEntries: entries.length,
  };
}

// Gate 1 (Order 100) + Gate 12 (Order 210): keep only monthly_payment rows, and only
// those whose dateOfPayment falls in the month under test.
// Contract 1099709 has EIGHT rows dated 2026-06-26 and only THREE are monthly: dropping
// the type filter makes June read 1,743 instead of 168.
function monthRows(payments, mk) {
  const all = Array.isArray(payments) ? payments : [];
  const unassignable = [];
  const inMonth = [];
  for (const p of all) {
    const code = p && p.typeOfPayment && p.typeOfPayment.code;
    if (code !== MONTHLY) continue;
    const dk = monthKey(p.dateOfPayment);
    // payment_due_month default: no dateOfPayment = the row cannot be assigned to a
    // month. Route to a human, never drop and never count in the audited month.
    if (dk === null) { unassignable.push(p); continue; }
    if (dk === mk) inMonth.push(p);
  }
  return { inMonth: inMonth, unassignable: unassignable };
}

function statusOf(p) {
  // status.value is authoritative. On all 117 future instalments of contract 1099709,
  // status.value = 'PDC' while status.label = 'PDP', so testing label matches nothing.
  return (p && p.status && p.status.value) || null;
}

// Gate 6 (Order 150): ALWAYS SUM the amount; never count rows. A RECEIVED row can be 0.00.
function sumReceived(rows) {
  let total = 0;
  let n = 0;
  for (const p of rows) {
    if (statusOf(p) !== COLLECTED) continue;
    const amt = parseMoney(p.amountOfPayment);
    // monthly_payment_amount default: missing or unreadable = 0 collected, month stays open.
    total += isNum(amt) ? amt : 0;
    n++;
  }
  return { total: total, rowCount: n };
}

// Gate 7 (Order 160): follow the replacement chain before flagging.
// replaced=true marks that a successor exists, NOT that the successor was paid.
function chainSettled(rows) {
  const failed = rows.filter(function (p) { return DEAD.indexOf(statusOf(p)) !== -1; });
  const replacedFlagged = failed.filter(function (p) { return p.replaced === true; });
  if (!replacedFlagged.length) return { settled: false, hadFailedRows: failed.length > 0, replacedFlagged: 0 };
  const successorReceived = rows.some(function (p) { return statusOf(p) === COLLECTED; });
  return { settled: successorReceived, hadFailedRows: true, replacedFlagged: replacedFlagged.length };
}

// Gate 15 (Order 50, runs SEVENTH on MV): money in flight covers the gap.
// Never treat an unrecognised status as dead. PRE_PDP and any unknown value count as in
// flight. Scoped to the month under test — an unscoped sum covers every month forever.
function sumInFlight(rows) {
  let total = 0;
  const statuses = [];
  for (const p of rows) {
    const s = statusOf(p);
    if (s === COLLECTED) continue;
    if (DEAD.indexOf(s) !== -1) continue;
    statuses.push(s);
    const amt = parseMoney(p.amountOfPayment);
    total += isNum(amt) ? amt : 0;
  }
  return { total: total, statuses: statuses };
}

// Gate 10 (Order 190): an unknown or missing payment type is a red flag, never a pass.
function badTypeRows(payments) {
  const all = Array.isArray(payments) ? payments : [];
  return all.filter(function (p) {
    const t = p && p.typeOfPayment;
    if (!t) return true;
    const code = t.code;
    if (code === null || code === undefined || code === '') return true;
    return KNOWN_TYPE_CODES.indexOf(code) === -1;
  });
}

// Gate 13 (Order 220): VIP. Pending Business — Malaz to rule whether vVip alone counts.
// Conservative default: only `vip` clears. Narrower exception = fewer clearances.
function isVip(contract, opts) {
  const vip = !!(contract && contract.vip);
  const vvip = !!(contract && contract.vVip);
  if (opts && opts.vipCountsVVip) return vip || vvip;
  return vip;
}

// Gate 14 (Order 230): discount or credit note covers the month.
// Never read a discount field for truthiness — a ZERO credit note is a non-empty string,
// and a discount is prose with a duration ("1000 applied on Service Fee over 4 months"
// is 250/month, not 1000). Unparsed relief is carried as context, never as coverage.
function reliefCoverage(contract, contractId, gap) {
  const notes = (contract && Array.isArray(contract.creditNotes)) ? contract.creditNotes : [];
  // Match the redemption pointer, not just the contract. Matching contract.id alone
  // stamped AED 3,665 of real relief as "NOT tied" on Travel Assist contract 1101379.
  const redeemed = notes.filter(function (n) {
    return n && String(n.redeemedContractId) === String(contractId);
  });
  let noteTotal = 0;
  for (const n of redeemed) {
    const amt = parseMoney(n.amount);
    if (isNum(amt)) noteTotal += amt;
  }

  const discountRaw = contract ? contract.discount : null;
  const discountPresent = !(discountRaw === null || discountRaw === undefined || String(discountRaw).trim() === '');
  // A discount is free prose with a duration. We do NOT parse a monthly figure out of it
  // here; it is surfaced as context for the verifier. Never let relief clear a bucket its
  // own text does not name.
  const covers = noteTotal > 0 && cmpMoney(noteTotal, gap) >= 0;

  return {
    covers: covers,
    creditNoteTotal: noteTotal,
    creditNotesRedeemed: redeemed.length,
    discountPresent: discountPresent,
    discountNeedsHuman: discountPresent,
  };
}

// Gate 16 (Order 250): a refund never nets off an uncollected month.
// A refund is a QUESTION, not a number. Surface it, never subtract it.
function refundContext(payments, mk) {
  const all = Array.isArray(payments) ? payments : [];
  const refunds = all.filter(function (p) {
    const code = (p && p.typeOfPayment && p.typeOfPayment.code) || '';
    const name = (p && p.typeOfPayment && p.typeOfPayment.name) || '';
    if (!/refund/i.test(code) && !/refund/i.test(name)) return false;
    const dk = monthKey(p.dateOfPayment);
    return dk === null || dk === mk;
  });
  return { refundPresent: refunds.length > 0, refundCount: refunds.length };
}

/**
 * Score one contract-month. One case = one contract-month.
 */
function scoreContractMonth(input) {
  const opts = input.options || {};
  const auditedMonth = input.auditedMonth;
  const contract = input.contract || {};
  const contractId = contract.id;
  const payments = input.payments || [];
  const evidence = input.evidence || {};
  const floor = isNum(opts.materialityFloor) ? opts.materialityFloor : 0;

  const out = {
    contractId: contractId,
    auditedMonth: auditedMonth,
    gatesRun: [],
    caps: [],
    needsVerifier: false,
    refundPresent: false,
  };
  const conclude = function (verdict, gate, reason, extra) {
    Object.assign(out, extra || {});
    out.verdict = verdict;
    out.gate = gate;
    out.reason = reason;
    return out;
  };

  // ── Gate 1 (100) — population ────────────────────────────────────────────────
  out.gatesRun.push('1');
  if (contract.prospectTypeCode !== 'maidvisa.ae_prospect') {
    return conclude(VERDICT.INCONCLUSIVE, '1', 'not an MV contract — out of population');
  }
  // client_id trap: client 24190 is the company owner, always excluded from findings.
  if (String(contract.clientId) === '24190') {
    return conclude(VERDICT.INCONCLUSIVE, '1', 'company owner account — excluded from findings');
  }

  // ── Gate 10 (190) — unknown/missing payment type is a red, never a silent pass ──
  // Evaluated on the contract's rows before the type filter can swallow them.
  out.gatesRun.push('10');
  const bad = badTypeRows(payments);
  if (bad.length) {
    return conclude(VERDICT.RED, '10', 'payment row carries an absent or unrecognised payment type', {
      redFlagType: RED_TYPE.BAD_TYPE,
      badTypeRowCount: bad.length,
      needsVerifier: true,
    });
  }

  // ── Gate 2 (110) — month must fall inside the contract's life ────────────────
  // Evaluated on the AUDITED month, per Order 110 running before Gate 5's Order 140.
  out.gatesRun.push('2');
  const life = monthInContractLife(contract, auditedMonth);
  if (!life.inLife) {
    return conclude(VERDICT.INCONCLUSIVE, '2', life.why + ' — no case');
  }
  out.isStartMonth = !!life.isStartMonth;

  // ── Gate 5 (140) — Pre-Collected ─────────────────────────────────────────────
  out.gatesRun.push('5');
  const pc = resolvePreCollected(contract);
  if (pc.unknown) {
    return conclude(VERDICT.INCONCLUSIVE, '5', 'is_pre_collected unreadable — halted rather than assumed false', {
      caps: ['is_pre_collected unknown'],
      needsVerifier: true,
    });
  }
  const mk = auditedMonth;
  out.monthUnderTest = mk;
  out.isPreCollected = pc.isPreCollected;
  out.advanceReceived = pc.advanceReceived;
  if (pc.isPreCollected && pc.advanceEntries === 0) {
    // pre_collected_payments default: an empty array on a contract flagged pre-collected
    // means NO advance is on record — inconclusive, route to the verifier. Never read
    // absence as "covered" and never read presence as "paid".
    out.caps.push('flagged pre-collected with no advance on record');
    out.needsVerifier = true;
  }

  // ── Gates 9 / 11 / 12 — derive the expectation ───────────────────────────────
  // These carry Orders 180/200/210 but are derivations, not verdicts, and Gate 11 states
  // it "runs before the amount comparison". The comparison at Gate 6 needs them, so they
  // are evaluated here. Recorded as a spec ordering observation, not a rule change.
  out.gatesRun.push('9', '11', '12');
  const exp = deriveExpected(contract);
  out.expected = exp.expected;
  out.expectedSource = exp.source;
  if (exp.crossCheckOk === false) {
    out.caps.push('split does not reconcile with currentPayment.amountValue');
    out.needsVerifier = true;
  }

  const rows = monthRows(payments, mk);
  if (rows.unassignable.length) {
    out.caps.push(rows.unassignable.length + ' monthly row(s) carry no dateOfPayment');
    out.needsVerifier = true;
  }

  const received = sumReceived(rows.inMonth);
  out.received = received.total;
  out.receivedRowCount = received.rowCount;

  const refunds = refundContext(payments, mk);
  out.refundPresent = refunds.refundPresent;
  out.refundCount = refunds.refundCount;
  if (refunds.refundPresent) {
    // Gate 16: a refund blocks a Report-to-PIL verdict until a human has read it.
    out.needsVerifier = true;
    out.caps.push('refund present — blocks PIL until read by a human');
  }

  // Gate 2's Never: never compare a first partial month against the full monthly amount.
  // Contract 1099709 starts 26 Jun; June's monthly is 168 (the fee alone) while July is
  // the full 1,638, and isProRated is false so that flag will not save you. On the start
  // month the timing test still runs; the amount test is suppressed as unknown.
  const amountTestable = isNum(exp.expected) && !out.isStartMonth;
  if (!amountTestable) {
    out.caps.push(out.isStartMonth
      ? 'first partial month — amount comparison suppressed, timing only'
      : 'expected amount unknown — amount comparison suppressed');
  }

  // ── Gate 6 (150) — a month is settled only when a payment reaches RECEIVED ───
  out.gatesRun.push('6');
  if (amountTestable && cmpMoney(received.total, exp.expected) >= 0) {
    return conclude(VERDICT.CLEAN, '6', 'month paid in full');
  }

  // ── Gate 7 (160) — follow the replacement chain before flagging ──────────────
  out.gatesRun.push('7');
  const chain = chainSettled(rows.inMonth);
  out.chainSettled = chain.settled;
  if (chain.settled) {
    // The chain settled the month. Where the amount is testable and still short, the
    // month is short-paid, not unsettled — fall through to the amount path.
    if (!amountTestable) {
      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');
    }
    if (cmpMoney(received.total, exp.expected) >= 0) {
      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');
    }
  }

  // ── Gate 15 (Order 50, runs seventh) — money in flight covers the gap ────────
  out.gatesRun.push('15');
  const gapForFlight = amountTestable ? (exp.expected - received.total) : null;
  const flight = sumInFlight(rows.inMonth);
  out.inFlight = flight.total;
  out.inFlightStatuses = flight.statuses;
  if (flight.total > 0) {
    if (gapForFlight === null) {
      return conclude(VERDICT.PENDING, '15', 'money scheduled in-month, expectation not testable — still in flight', {
        needsVerifier: true,
      });
    }
    if (cmpMoney(flight.total, gapForFlight) >= 0) {
      return conclude(VERDICT.PENDING, '15', 'scheduled in-month money covers the gap — not settled, not a shortfall');
    }
  }

  // Timing axis: did ANY money arrive for this month?
  const anyMoney = received.total > 0;

  // ── Gate 4 (165) — no 1st-of-month payment and not Pre-Collected ─────────────
  out.gatesRun.push('4');
  if (!anyMoney && pc.isPreCollected === false) {
    if (received.rowCount === 0 && rows.inMonth.length === 0 && !isNum(exp.expected)) {
      return conclude(VERDICT.INCONCLUSIVE, '4', 'no rows and no expectation for the month', { needsVerifier: true });
    }
    // Materiality floor: some BOUNCED rows carry zero and are not money. Default 0 =
    // no floor, flag everything. Owner question open.
    const owed = isNum(exp.expected) ? exp.expected : null;
    if (owed !== null && floor > 0 && cmpMoney(owed, floor) < 0) {
      return conclude(VERDICT.CLEAN, '4', 'owed amount below the materiality floor', { belowFloor: true });
    }
    return conclude(VERDICT.RED, '4', 'month owed, nothing settled it, no exception path applies', {
      redFlagType: RED_TYPE.MISSING_1ST,
      gap: owed,
      needsVerifier: true,
    });
  }

  // ── Gate 8 (170) — catch-all: no RECEIVED payment for the month ──────────────
  out.gatesRun.push('8');
  if (!anyMoney) {
    const owed = isNum(exp.expected) ? exp.expected : null;
    if (owed !== null && floor > 0 && cmpMoney(owed, floor) < 0) {
      return conclude(VERDICT.CLEAN, '8', 'owed amount below the materiality floor', { belowFloor: true });
    }
    // Pre-Collected reaches here only because Gate 4 excluded it. The spec's shift is
    // contradicted by its own test cases (see resolvePreCollected), so an unsettled
    // pre-collected month is routed to a human rather than concluded either way. This
    // inflates the inconclusive count and is declared in the run summary.
    if (pc.isPreCollected === true) {
      return conclude(VERDICT.INCONCLUSIVE, '8', 'pre-collected contract with an unsettled month — advance path needs a human', {
        redFlagType: RED_TYPE.MISSING_PREV,
        gap: owed,
        needsVerifier: true,
        caps: out.caps.concat(['pre-collected shift ambiguous — not concluded']),
      });
    }
    return conclude(VERDICT.RED, '8', 'the month exists, the contract was live, and nothing ever settled it', {
      redFlagType: RED_TYPE.MISSING_1ST,
      gap: owed,
      needsVerifier: true,
    });
  }

  // Money arrived but the month is not full. From here the shape is an AMOUNT mismatch.
  // Gate 3's Never: never merge a timing failure and an amount mismatch into one case.
  if (!amountTestable) {
    return conclude(VERDICT.CLEAN, '6', 'money arrived and the amount is not comparable for this month');
  }

  const gap = exp.expected - received.total;
  out.gap = gap;

  // ── Gate 13 (220) — VIP, only on a surviving mismatch ────────────────────────
  // Reached only after the timing reds at Orders 165/170 have concluded, so VIP can
  // clear an amount mismatch and never a month nobody paid.
  out.gatesRun.push('13');
  if (isVip(contract, opts)) {
    return conclude(VERDICT.CLEAN_VIP, '13', 'amount mismatch on a VIP client — closed as VIP exception', {
      vipRuleUnresolved: !opts.vipCountsVVip,
    });
  }

  // ── Gate 14 (230) — discount or credit note covers the month ─────────────────
  out.gatesRun.push('14');
  const relief = reliefCoverage(contract, contractId, gap);
  out.creditNoteTotal = relief.creditNoteTotal;
  out.discountPresent = relief.discountPresent;
  if (relief.covers) {
    return conclude(VERDICT.CLEAN, '14', 'credit note redeemed on this contract covers the gap');
  }
  if (relief.discountNeedsHuman) {
    out.needsVerifier = true;
    out.caps.push('discount text present — duration not parsed, needs a human');
  }

  // ── Gate 17 (240) — a short-paid month is the amount-mismatch finding ────────
  out.gatesRun.push('17');
  if (gap > 0 && floor > 0 && cmpMoney(gap, floor) < 0) {
    return conclude(VERDICT.CLEAN, '17', 'shortfall below the materiality floor', { belowFloor: true });
  }
  return conclude(VERDICT.RED, '17', 'money arrived for the month and is below the contract plan', {
    redFlagType: RED_TYPE.AMOUNT,
    needsVerifier: true,
  });
}

// ── Verifier layer (Orders 260–300) ───────────────────────────────────────────
// Runs only on a case the deterministic layer left as a finding. Absent evidence must
// halt the case, never satisfy the comparison.
function applyVerifier(caseOut, evidence, asOfDate) {
  const ev = evidence || {};
  const res = Object.assign({}, caseOut);
  res.verifierGatesRun = [];

  if (caseOut.verdict !== VERDICT.RED) return res;

  // Verifier 4's Never: never raise the 10-day rule without having read the message log
  // successfully. A failed or empty read is UNKNOWN, not "nobody chased".
  if (ev.messageLogRead !== true) {
    res.verifierGatesRun.push('4');
    res.pilBlocked = true;
    res.caps = (res.caps || []).concat(['message log unread — 10-day rule not evaluable, PIL blocked']);
    return res;
  }

  // Verifier 2 (270): staff wrote down a reason that accounts for THIS month's gap.
  res.verifierGatesRun.push('2');
  if (ev.explanationForThisMonth === true) {
    res.verdict = VERDICT.CLEAN;
    res.reason = 'staff-written evidence names a reason for this month';
    res.verifierGate = '2';
    return res;
  }

  // Verifier 3 (280): a follow-up must ask for money, have been delivered, and be dated
  // from sentDate. Verifier 5 (300) vs 4 (290).
  res.verifierGatesRun.push('3');
  const last = ev.qualifyingFollowupSentDate ? new Date(ev.qualifyingFollowupSentDate) : null;
  const asOf = new Date(asOfDate);
  if (last && !isNaN(last.getTime())) {
    const days = (asOf - last) / 86400000;
    if (days <= 10) {
      res.verifierGatesRun.push('5');
      res.verdict = VERDICT.PENDING;
      res.reason = 'chased within the last 10 days — awaiting reviewer, not escalated';
      res.verifierGate = '5';
      return res;
    }
  }
  res.verifierGatesRun.push('4');
  res.verifierGate = '4';
  res.reason = (res.reason || '') + '; no qualifying follow-up in the last 10 days';
  res.pilBlocked = !!caseOut.refundPresent;
  return res;
}

module.exports = {
  scoreContractMonth, applyVerifier, deriveExpected, parseMoney, shiftMonth,
  monthKey, VERDICT, RED_TYPE, KNOWN_TYPE_CODES,
};
