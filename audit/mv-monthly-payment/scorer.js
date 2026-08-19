'use strict';

// MV Monthly Payment check — deterministic scorer.
// Spec: Notion "MV Monthly Payment check" v0.8, 17 deterministic gates + 5 verifier rules.
// Built standalone so it can be tested offline against the spec's own test cases before
// it goes near n8n. Every gate below cites its numeral and Order.

const COLLECTED = 'RECEIVED';
const MONTHLY = 'monthly_payment';

// The COMPLETE PaymentStatus enum — all 14 constants, from PaymentStatus.java:15-29 via LCP
// 2026-08-19, each classified by what it means for money.
//
// THIS LIST BEING SHORT IS A SUPPRESSED FINDING. Gate 15 says "never treat an unrecognised
// status as dead — any unknown value counts as in flight", which is right as a safety net and
// catastrophic as a substitute for knowing the enum: five of these constants are DEAD, and
// treating them as in-flight lets them "cover the gap" and park a real red in `pending`
// forever. RETURNED_TO_CLIENT was found live on a real row while the scorer knew only five
// statuses.
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

// No status means "collected then refunded". A genuine reversal is a separate payment of a
// refund TYPE plus a ClientRefundToDo, which is why gate 16 reads types, not statuses.

// Known payment-type codes. Live-observed values are marked; the rest come from the spec's
// exclusion list. Gate 10 no longer reds on an unrecognised-but-present code — see
// badTypeRows — because six legitimate codes were missing from this list on a 14-contract
// sample, and a blanket red would have flooded the queue with clean contracts.
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
// OWNER RULING 2026-08-19, verbatim: "for pre collected contracts we only care about previous
// months, current months don't matter." So the shift is a real SCOPE shift, not just a label —
// auditing month M on a pre-collected contract tests month M-1's obligation. My earlier
// label-only reading is superseded.
//
// Validated against the ledger of confirmed red 1074171 (pre-collected): every month 2026-01
// to 2026-05 settled at 2,405, 2026-06 BOUNCED with nothing received, 2026-07 settled again.
// Auditing 2026-07 tests 2026-06 and the red fires. Auditing 2026-06 tests 2026-05, which is
// paid, so it correctly says nothing.
//
// CRITICAL INTERACTION: gate 2 (contract life) must be evaluated on the SHIFTED month, not the
// audited one. Contract 1074171 terminated 2026-06-14, so an audited month of 2026-07 is past
// termination — testing gate 2 on the audited month would put the whole case out of scope and
// SUPPRESS this verified red. The month whose obligation is being tested is the month that has
// to be inside the contract's life.
//
// Same for the first-partial-month suppression: 1099709 starts 26 Jun, so auditing 2026-07
// tests June, which is its start month, and the amount comparison must stay suppressed there.
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
    shifted: flag === true,
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
  const failed = rows.filter(function (p) { return STATUS_DEAD.indexOf(statusOf(p)) !== -1; });
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
  const unknown = [];
  for (const p of rows) {
    const s = statusOf(p);
    if (STATUS_COLLECTED.indexOf(s) !== -1) continue;
    if (STATUS_DEAD.indexOf(s) !== -1) continue;
    // Gate 15's safety net, now applied only to values genuinely outside the enum: an
    // unknown status counts as in flight, because one that really meant collected would
    // leave a false red standing. Recorded so a new constant surfaces instead of hiding.
    if (STATUS_IN_FLIGHT.indexOf(s) === -1) unknown.push(s);
    statuses.push(s);
    const amt = parseMoney(p.amountOfPayment);
    total += isNum(amt) ? amt : 0;
  }
  return { total: total, statuses: statuses, unknownStatuses: unknown };
}

// Gate 10 (Order 190): an unknown or missing payment type is a red flag, never a pass.
// SPLIT 2026-08-19 after live data. The rule reds on a type that is "absent, or outside the
// known set". A 14-contract sample carried SIX legitimate codes missing from the known set
// (insurance, overstay_fee, Urgent_visa_charges, non-mp-refund, service_charge, oec), so a
// blanket red would flood the queue with clean contracts.
//
// The failure the rule actually guards against is an unrecognised type "falling through the
// monthly filter and closing the month green". That cannot happen here: only monthly_payment
// rows are ever summed, so an excluded row makes a month look LESS paid, never more. The
// protection needed is that it is never silently dropped.
//
// So: absent or empty code -> red (a real data problem). Unrecognised but present -> surfaced
// on the case and routed to a human, never summed as payment, never a blanket red.
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

// Gate 13 (Order 220): VIP.
// OWNER RULING 2026-08-19: "both count as vip yes, vvip and vip." Previously Pending Business.
// Set vipCountsVVip: false to go back to the narrow reading.
function isVip(contract, opts) {
  const vip = !!(contract && contract.vip);
  const vvip = !!(contract && contract.vVip);
  if (opts && opts.vipCountsVVip === false) return vip;
  return vip || vvip;
}

// Gate 14 (Order 230): discount or credit note covers the month.
//
// CORRECTED against live data 2026-08-19. The `contract_discount` variable row names the
// field `discount` on CONTRACT_DETAILS. There is no such key. The real relief signals are
// two FREE-PROSE strings on the plan:
//   paymentPlan.additionalDiscount  e.g. "Discount Amount: 0 applied on 2-year visa"
//   paymentPlan.creditNoteDiscount  e.g. "Credit Note Amount: 0 applied on 2-year visa"
// Both are absent as '' and, when present, carry an amount AND the bucket they apply to.
// A ZERO discount is still a non-empty string, so a truthiness test reads it as relief.
//
// No structured credit-note source with a redemption pointer has been located on this
// payload, so this gate NEVER auto-clears from prose: relief is carried as context and the
// case is routed to a human. That removes an auto-clearance path rather than adding one.
// The structured path stays behind an explicit opt-in for when the credit-note route is
// found; it also enforces the redemption-pointer rule (matching contract.id alone stamped
// AED 3,665 of real relief as "NOT tied" on Travel Assist contract 1101379).
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
      // Never let relief clear a bucket its own text does not name.
      namesMonthlyBucket: MONTHLY_BUCKET.test(String(raw)),
      // A zero discount is prose, not money.
      nonZero: isNum(amt) && amt > 0,
    });
  }
  const present = texts.length > 0;
  const material = texts.filter(function (t) { return t.nonZero && t.namesMonthlyBucket; });

  // Structured notes: opt-in only, and only ones redeemed ON this contract.
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
  // OWNER RULING 2026-08-19: "yes even the little amounts Matter, 0 payments do not tho."
  // So there is NO materiality floor on small amounts — a case opens on any amount strictly
  // above zero, however small — but a case with nothing at stake does not open at all.
  // materialityFloor stays wired at 0 so a future floor is a one-line change; the comparison
  // is strictly-greater-than, which is what makes zero the only excluded value today.
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

  // ── Gate 5 (140) — Pre-Collected decides WHICH month is under test ──────────
  // Evaluated before gate 2 because gate 2 must bound the month whose obligation is being
  // tested. See the note on resolvePreCollected for why the audited month is the wrong one.
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

  // ── Gate 2 (110) — the month under test must fall inside the contract's life ─
  out.gatesRun.push('2');
  const life = monthInContractLife(contract, mk);
  if (!life.inLife) {
    return conclude(VERDICT.INCONCLUSIVE, '2', life.why + ' — no case');
  }
  out.isStartMonth = !!life.isStartMonth;

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

  // Owner ruling 2026-08-19: a month with nothing at stake raises no case. Concluded here,
  // ahead of gate 6, so the reason reads "nothing owed" rather than "paid in full" — the
  // verdict is the same either way but the case text should say which it is.
  if (isNum(exp.expected) && cmpMoney(exp.expected, floor) <= 0) {
    return conclude(VERDICT.CLEAN, '6', 'nothing was owed for this month — no money at stake', {
      zeroAtStake: true,
    });
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
    if (owed !== null && cmpMoney(owed, floor) <= 0) {
      return conclude(VERDICT.CLEAN, '4', 'nothing was owed for this month — no money at stake', { zeroAtStake: true });
    }
    if (owed === null) {
      // Unknown amount with nothing received is not "no money at stake". Never let an
      // unreadable expectation be silently dropped by the amount test.
      out.caps.push('month unsettled but the owed amount could not be read');
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
    if (owed !== null && cmpMoney(owed, floor) <= 0) {
      return conclude(VERDICT.CLEAN, '8', 'nothing was owed for this month — no money at stake', { zeroAtStake: true });
    }
    if (owed === null) out.caps.push('month unsettled but the owed amount could not be read');
    // Pre-Collected reaches here because Gate 4 excluded it. It is an exception PATH, not an
    // exemption: the month is still a finding, carrying the previous-month label. Confirmed
    // live on red 1074171, which is pre-collected and would be SUPPRESSED by treating this
    // as inconclusive.
    return conclude(VERDICT.RED, '8', 'the month exists, the contract was live, and nothing ever settled it', {
      redFlagType: pc.shifted ? RED_TYPE.MISSING_PREV : RED_TYPE.MISSING_1ST,
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
      vipCountsVVip: opts.vipCountsVVip !== false,
    });
  }

  // ── Gate 14 (230) — discount or credit note covers the month ─────────────────
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

  // ── Gate 17 (240) — a short-paid month is the amount-mismatch finding ────────
  out.gatesRun.push('17');
  if (cmpMoney(gap, floor) <= 0) {
    return conclude(VERDICT.CLEAN, '17', 'no shortfall at stake', { zeroAtStake: true });
  }
  return conclude(VERDICT.RED, '17', 'money arrived for the month and is below the contract plan', {
    redFlagType: RED_TYPE.AMOUNT,
    needsVerifier: true,
  });
}

// ── Verifier rule 3 (Order 280) — what counts as a follow-up ──────────────────
// CORRECTED against live data 2026-08-19. The rule says date a follow-up from `sentDate`
// and never `creationDate` because the latter "returns null on every row". Both halves are
// wrong about the SMS channel and right about WhatsApp:
//   messageType=SMS      -> rows carry creationDate, POPULATED on 20/20. No sentDate at all.
//   messageType=WHATSAPP -> rows carry sentDate, populated on 27/27, plus deliveryStatus
//                           and templateName.
// Only WHATSAPP can satisfy all three of the rule's tests, so that is the channel to read.
// Route: GET /clientmgmt/client/smsLog/{clientId}?messageType=WHATSAPP&emailSubject=
// (`emailSubject` is a required param on every channel; pass it empty.)

// deliveryStatus observed live: READ, RESPONDED, DELIVERED, SKIPPED, FAILED.
// A row is not a delivery — SKIPPED and FAILED never count.
const DELIVERED_STATUSES = ['DELIVERED', 'READ', 'RESPONDED'];

// Templates that genuinely ask for money. Open-ended on purpose.
const CHASE_PATTERNS = [
  /bounced.*payment|payment.*bounced/i,
  /payment_for_approval_request/i,
  /dd_messaging_setup.*bounced/i,
  /collection|overdue|unpaid|outstanding|arrears/i,
  /payment.*reminder|reminder.*payment/i,
];

// Never a chase, even when the name contains "payment". MV_PAYMENT_RECEIVED_NOTIFICATION is
// a RECEIPT — counting it as chasing suppresses a real finding, which is the same failure
// shape as counting win-back marketing. CM_CLIENT_BROADCAST_* and
// PRE_SALE_CRM_CAMPAIGN_ACTION_* are the campaign shape the rule names.
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
  // A bare numeric template id cannot be classified. Unknown is NOT a chase — that keeps
  // the finding alive rather than suppressing it.
  if (/^\d+$/.test(name.trim())) return { qualifies: false, why: 'unclassifiable template id' };
  for (const p of NOT_CHASE_PATTERNS) {
    if (p.test(name)) return { qualifies: false, why: 'not a payment chase: ' + name.slice(0, 40) };
  }
  for (const p of CHASE_PATTERNS) {
    if (p.test(name)) return { qualifies: true, sentDate: sent, why: 'payment chase' };
  }
  return { qualifies: false, why: 'template does not ask for money' };
}

// Returns ONLY the date. Message content and phone numbers must never leave this endpoint.
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
  monthKey, classifyFollowup, lastQualifyingFollowup,
  VERDICT, RED_TYPE, KNOWN_TYPE_CODES, DELIVERED_STATUSES,
  STATUS_COLLECTED, STATUS_IN_FLIGHT, STATUS_DEAD,
};
