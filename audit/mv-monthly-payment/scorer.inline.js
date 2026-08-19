const COLLECTED = 'RECEIVED';
const MONTHLY = 'monthly_payment';

const STATUS_COLLECTED = ['RECEIVED'];

const STATUS_IN_FLIGHT = [
  'PDC',        // post-dated cheque held, not yet due. UI label "PDP".
  'PRE_PDP',    // scheduled DD or card.
  'ADCB_PDC',   // ADCB post-dated cheque variant.
  'DEPOSIT',    // deposited at bank, awaiting clearance.
  'FROZEN',     // held/frozen at the bank — not settled, not dead.
  'REQUESTED',  // requested, not yet collected.
];

const STATUS_DEAD = [
  'BOUNCED',                          // failed / rejected by bank.
  'DELETED',                          // record cancelled.
  'TEARED_UP',                        // instrument physically voided.
  'RETURNED_TO_CLIENT',               // cheque handed back. UI "Returned to family".
  'UNCOLLECTED',                      // never collected / written off.
  'CANCELLED',
  'CANCELLED_WAITING_CLIENT_PICKUP',
];

const KNOWN_TYPE_CODES = [
  'monthly_payment',                  // live
  'monthly_payment_add_on',
  'pre_collected_payment',            // live
  'pre_collected_payment_no_vat',     // live
  'transfer_fee',                     // live
  'same_day_recruitment_fee',         // live
  'insurance',                        // live
  'overstay_fee',                     // live (NOT "overstay_fine")
  'Urgent_visa_charges',              // live — note the mixed case
  'non-mp-refund',                    // live — note the hyphens
  'service_charge',                   // live
  'oec',                              // live
  'visa_2_years', 'wps_processing_fee', 'gcc_fee',
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

function cmpMoney(a, b) {
  const d = Math.round((a - b) * 100);
  return d === 0 ? 0 : (d > 0 ? 1 : -1);
}

function deriveExpected(contract) {
  const singular = parseMoney(contract && contract.currentPayment && contract.currentPayment.amountValue);
  const rows = (contract && Array.isArray(contract.currentPayments)) ? contract.currentPayments : [];

  const monthlyRows = rows.filter(function (r) {
    const code = r && r.paymentTypeCode;
    return code === MONTHLY || code === 'pre_collected_payment' || code === 'pre_collected_payment_no_vat';
  });
  const row = monthlyRows.length ? monthlyRows[0] : null;

  let split = null;
  if (row) {
    const salary = parseMoney(row.workerSalary);
    const fees = parseMoney(row.visaFees);
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

  let crossCheckOk = null;
  if (isNum(split) && isNum(singular)) crossCheckOk = cmpMoney(split, singular) === 0;

  return { expected: expected, source: source, split: split, singular: singular, crossCheckOk: crossCheckOk };
}

function monthInContractLife(contract, mk) {
  const start = monthKey(contract && contract.startDate);
  const end = monthKey(
    (contract && contract.dateOfTermination) ||
    (contract && contract.isScheduledForTermination ? contract.scheduledDateOfTermination : null)
  );
  if (start && mk < start) return { inLife: false, why: 'month precedes contract start' };
  if (end && mk > end) return { inLife: false, why: 'month follows contract termination' };
  return { inLife: true, isStartMonth: !!(start && start === mk) };
}

function resolvePreCollected(contract) {
  const pc = contract && contract.preCollectedInfo;
  const flag = pc ? pc.isPreCollectedSalary : undefined;
  if (flag === undefined || flag === null) {
    return { isPreCollected: null, unknown: true, advanceReceived: null, advanceEntries: 0 };
  }
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
    shifted: flag === true,
    advanceReceived: entries.length ? advance : null,
    advanceEntries: entries.length,
  };
}

function monthRows(payments, mk) {
  const all = Array.isArray(payments) ? payments : [];
  const unassignable = [];
  const inMonth = [];
  for (const p of all) {
    const code = p && p.typeOfPayment && p.typeOfPayment.code;
    if (code !== MONTHLY) continue;
    const dk = monthKey(p.dateOfPayment);
    if (dk === null) { unassignable.push(p); continue; }
    if (dk === mk) inMonth.push(p);
  }
  return { inMonth: inMonth, unassignable: unassignable };
}

function statusOf(p) {
  return (p && p.status && p.status.value) || null;
}

function sumReceived(rows) {
  let total = 0;
  let n = 0;
  for (const p of rows) {
    if (statusOf(p) !== COLLECTED) continue;
    const amt = parseMoney(p.amountOfPayment);
    total += isNum(amt) ? amt : 0;
    n++;
  }
  return { total: total, rowCount: n };
}

function chainSettled(rows) {
  const failed = rows.filter(function (p) { return STATUS_DEAD.indexOf(statusOf(p)) !== -1; });
  const replacedFlagged = failed.filter(function (p) { return p.replaced === true; });
  if (!replacedFlagged.length) return { settled: false, hadFailedRows: failed.length > 0, replacedFlagged: 0 };
  const successorReceived = rows.some(function (p) { return statusOf(p) === COLLECTED; });
  return { settled: successorReceived, hadFailedRows: true, replacedFlagged: replacedFlagged.length };
}

function sumInFlight(rows) {
  let total = 0;
  const statuses = [];
  const unknown = [];
  for (const p of rows) {
    const s = statusOf(p);
    if (STATUS_COLLECTED.indexOf(s) !== -1) continue;
    if (STATUS_DEAD.indexOf(s) !== -1) continue;
    if (STATUS_IN_FLIGHT.indexOf(s) === -1) unknown.push(s);
    statuses.push(s);
    const amt = parseMoney(p.amountOfPayment);
    total += isNum(amt) ? amt : 0;
  }
  return { total: total, statuses: statuses, unknownStatuses: unknown };
}

function badTypeRows(payments) {
  const all = Array.isArray(payments) ? payments : [];
  const absent = [];
  const unrecognised = [];
  for (const p of all) {
    const t = p && p.typeOfPayment;
    const code = t ? t.code : undefined;
    if (!t || code === null || code === undefined || String(code).trim() === '') {
      absent.push(p);
    } else if (KNOWN_TYPE_CODES.indexOf(code) === -1) {
      unrecognised.push(code);
    }
  }
  return { absent: absent, unrecognised: Array.from(new Set(unrecognised)) };
}

function isVip(contract, opts) {
  const vip = !!(contract && contract.vip);
  const vvip = !!(contract && contract.vVip);
  if (opts && opts.vipCountsVVip === false) return vip;
  return vip || vvip;
}

const MONTHLY_BUCKET = /monthly|maid'?s? salary|wps processing \+ maid salary|service fee/i;

function reliefCoverage(contract, contractId, gap, opts) {
  const plan = (contract && contract.paymentPlan) || {};
  const texts = [];
  for (const key of ['additionalDiscount', 'creditNoteDiscount']) {
    const raw = plan[key];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const amt = parseMoney(String(raw).replace(/over\s+\d+\s+months?/i, ''));
    texts.push({
      field: 'paymentPlan.' + key,
      namesMonthlyBucket: MONTHLY_BUCKET.test(String(raw)),
      nonZero: isNum(amt) && amt > 0,
    });
  }
  const present = texts.length > 0;
  const material = texts.filter(function (t) { return t.nonZero && t.namesMonthlyBucket; });

  let noteTotal = 0;
  let redeemed = 0;
  if (opts && opts.useStructuredCreditNotes && Array.isArray(contract && contract.creditNotes)) {
    for (const n of contract.creditNotes) {
      if (!n || String(n.redeemedContractId) !== String(contractId)) continue;
      redeemed++;
      const amt = parseMoney(n.amount);
      if (isNum(amt)) noteTotal += amt;
    }
  }

  return {
    covers: noteTotal > 0 && cmpMoney(noteTotal, gap) >= 0,
    creditNoteTotal: noteTotal,
    creditNotesRedeemed: redeemed,
    reliefTextPresent: present,
    materialMonthlyRelief: material.length > 0,
    reliefFields: texts.map(function (t) { return t.field; }),
    discountNeedsHuman: material.length > 0,
  };
}

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

  out.gatesRun.push('1');
  if (contract.prospectTypeCode !== 'maidvisa.ae_prospect') {
    return conclude(VERDICT.INCONCLUSIVE, '1', 'not an MV contract — out of population');
  }
  if (String(contract.clientId) === '24190') {
    return conclude(VERDICT.INCONCLUSIVE, '1', 'company owner account — excluded from findings');
  }

  out.gatesRun.push('10');
  const bad = badTypeRows(payments);
  if (bad.absent.length) {
    return conclude(VERDICT.RED, '10', 'payment row carries no payment type at all', {
      redFlagType: RED_TYPE.BAD_TYPE,
      badTypeRowCount: bad.absent.length,
      needsVerifier: true,
    });
  }
  if (bad.unrecognised.length) {
    out.unrecognisedTypeCodes = bad.unrecognised;
    out.needsVerifier = true;
    out.caps.push('unrecognised payment type code(s) on the contract: ' + bad.unrecognised.join(', '));
  }

  out.gatesRun.push('5');
  const pc = resolvePreCollected(contract);
  if (pc.unknown) {
    return conclude(VERDICT.INCONCLUSIVE, '5', 'is_pre_collected unreadable — halted rather than assumed false', {
      caps: ['is_pre_collected unknown'],
      needsVerifier: true,
    });
  }
  const mk = pc.isPreCollected ? shiftMonth(auditedMonth, -1) : auditedMonth;
  out.monthUnderTest = mk;
  out.isPreCollected = pc.isPreCollected;
  out.monthShifted = pc.shifted;
  out.advanceReceived = pc.advanceReceived;
  if (pc.isPreCollected && pc.advanceEntries === 0) {
    out.caps.push('flagged pre-collected with no advance on record');
    out.needsVerifier = true;
  }

  out.gatesRun.push('2');
  const life = monthInContractLife(contract, mk);
  if (!life.inLife) {
    return conclude(VERDICT.INCONCLUSIVE, '2', life.why + ' — no case');
  }
  out.isStartMonth = !!life.isStartMonth;

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
    out.needsVerifier = true;
    out.caps.push('refund present — blocks PIL until read by a human');
  }

  const amountTestable = isNum(exp.expected) && !out.isStartMonth;
  if (!amountTestable) {
    out.caps.push(out.isStartMonth
      ? 'first partial month — amount comparison suppressed, timing only'
      : 'expected amount unknown — amount comparison suppressed');
  }

  if (isNum(exp.expected) && cmpMoney(exp.expected, floor) <= 0) {
    return conclude(VERDICT.CLEAN, '6', 'nothing was owed for this month — no money at stake', {
      zeroAtStake: true,
    });
  }

  out.gatesRun.push('6');
  if (amountTestable && cmpMoney(received.total, exp.expected) >= 0) {
    return conclude(VERDICT.CLEAN, '6', 'month paid in full');
  }

  out.gatesRun.push('7');
  const chain = chainSettled(rows.inMonth);
  out.chainSettled = chain.settled;
  if (chain.settled) {
    if (!amountTestable) {
      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');
    }
    if (cmpMoney(received.total, exp.expected) >= 0) {
      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');
    }
  }

  out.gatesRun.push('15');
  const gapForFlight = amountTestable ? (exp.expected - received.total) : null;
  const flight = sumInFlight(rows.inMonth);
  out.inFlight = flight.total;
  out.inFlightStatuses = flight.statuses;
  if (flight.unknownStatuses && flight.unknownStatuses.length) {
    out.unknownStatuses = flight.unknownStatuses;
    out.needsVerifier = true;
    out.caps.push('status value(s) outside the known enum, counted as in flight: ' + flight.unknownStatuses.join(', '));
  }
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

  const anyMoney = received.total > 0;

  out.gatesRun.push('4');
  if (!anyMoney && pc.isPreCollected === false) {
    if (received.rowCount === 0 && rows.inMonth.length === 0 && !isNum(exp.expected)) {
      return conclude(VERDICT.INCONCLUSIVE, '4', 'no rows and no expectation for the month', { needsVerifier: true });
    }
    const owed = isNum(exp.expected) ? exp.expected : null;
    if (owed !== null && cmpMoney(owed, floor) <= 0) {
      return conclude(VERDICT.CLEAN, '4', 'nothing was owed for this month — no money at stake', { zeroAtStake: true });
    }
    if (owed === null) {
      out.caps.push('month unsettled but the owed amount could not be read');
    }
    return conclude(VERDICT.RED, '4', 'month owed, nothing settled it, no exception path applies', {
      redFlagType: RED_TYPE.MISSING_1ST,
      gap: owed,
      needsVerifier: true,
    });
  }

  out.gatesRun.push('8');
  if (!anyMoney) {
    const owed = isNum(exp.expected) ? exp.expected : null;
    if (owed !== null && cmpMoney(owed, floor) <= 0) {
      return conclude(VERDICT.CLEAN, '8', 'nothing was owed for this month — no money at stake', { zeroAtStake: true });
    }
    if (owed === null) out.caps.push('month unsettled but the owed amount could not be read');
    return conclude(VERDICT.RED, '8', 'the month exists, the contract was live, and nothing ever settled it', {
      redFlagType: pc.shifted ? RED_TYPE.MISSING_PREV : RED_TYPE.MISSING_1ST,
      gap: owed,
      needsVerifier: true,
    });
  }

  if (!amountTestable) {
    return conclude(VERDICT.CLEAN, '6', 'money arrived and the amount is not comparable for this month');
  }

  const gap = exp.expected - received.total;
  out.gap = gap;

  out.gatesRun.push('13');
  if (isVip(contract, opts)) {
    return conclude(VERDICT.CLEAN_VIP, '13', 'amount mismatch on a VIP client — closed as VIP exception', {
      vipCountsVVip: opts.vipCountsVVip !== false,
    });
  }

  out.gatesRun.push('14');
  const relief = reliefCoverage(contract, contractId, gap, opts);
  out.creditNoteTotal = relief.creditNoteTotal;
  out.reliefTextPresent = relief.reliefTextPresent;
  out.reliefFields = relief.reliefFields;
  if (relief.covers) {
    return conclude(VERDICT.CLEAN, '14', 'credit note redeemed on this contract covers the gap');
  }
  if (relief.discountNeedsHuman) {
    out.needsVerifier = true;
    out.caps.push('relief prose names the monthly bucket with a nonzero amount — duration not parsed, needs a human');
  }

  out.gatesRun.push('17');
  if (cmpMoney(gap, floor) <= 0) {
    return conclude(VERDICT.CLEAN, '17', 'no shortfall at stake', { zeroAtStake: true });
  }
  return conclude(VERDICT.RED, '17', 'money arrived for the month and is below the contract plan', {
    redFlagType: RED_TYPE.AMOUNT,
    needsVerifier: true,
  });
}

const DELIVERED_STATUSES = ['DELIVERED', 'READ', 'RESPONDED'];

const CHASE_PATTERNS = [
  /bounced.*payment|payment.*bounced/i,
  /payment_for_approval_request/i,
  /dd_messaging_setup.*bounced/i,
  /collection|overdue|unpaid|outstanding|arrears/i,
  /payment.*reminder|reminder.*payment/i,
];

const NOT_CHASE_PATTERNS = [
  /received|confirmation|receipt|thank/i,
  /broadcast|campaign|pre_sale|returning_clients|win_?back/i,
  /otp|birthday|medical|vat/i,
];

function classifyFollowup(row) {
  const name = (row && row.templateName) || '';
  const status = (row && row.deliveryStatus) || '';
  const sent = (row && row.sentDate) || null;

  if (!sent) return { qualifies: false, why: 'no sentDate' };
  if (DELIVERED_STATUSES.indexOf(status) === -1) {
    return { qualifies: false, why: 'not delivered (' + (status || 'no status') + ')' };
  }
  if (/^\d+$/.test(name.trim())) return { qualifies: false, why: 'unclassifiable template id' };
  for (const p of NOT_CHASE_PATTERNS) {
    if (p.test(name)) return { qualifies: false, why: 'not a payment chase: ' + name.slice(0, 40) };
  }
  for (const p of CHASE_PATTERNS) {
    if (p.test(name)) return { qualifies: true, sentDate: sent, why: 'payment chase' };
  }
  return { qualifies: false, why: 'template does not ask for money' };
}

function lastQualifyingFollowup(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let best = null;
  let considered = 0;
  for (const r of list) {
    considered++;
    const c = classifyFollowup(r);
    if (!c.qualifies) continue;
    const d = String(c.sentDate).slice(0, 10);
    if (!best || d > best) best = d;
  }
  return { lastFollowupDate: best, rowsConsidered: considered };
}

function applyVerifier(caseOut, evidence, asOfDate) {
  const ev = evidence || {};
  const res = Object.assign({}, caseOut);
  res.verifierGatesRun = [];

  if (caseOut.verdict !== VERDICT.RED) return res;

  if (ev.messageLogRead !== true) {
    res.verifierGatesRun.push('4');
    res.pilBlocked = true;
    res.caps = (res.caps || []).concat(['message log unread — 10-day rule not evaluable, PIL blocked']);
    return res;
  }

  res.verifierGatesRun.push('2');
  if (ev.explanationForThisMonth === true) {
    res.verdict = VERDICT.CLEAN;
    res.reason = 'staff-written evidence names a reason for this month';
    res.verifierGate = '2';
    return res;
  }

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