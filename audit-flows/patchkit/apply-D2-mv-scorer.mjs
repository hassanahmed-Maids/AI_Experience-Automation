// D2 — MV Monthly: the expectation comes from the month's own ledger row, not the
// contract plan as it stands today.
//
//   node apply-D2-mv-scorer.mjs audit/mv-monthly-payment/scorer.stage2.js
//
// Grounded on 240 real contract-months (execution 94336): EXACTLY ONE monthly_payment
// row per contract-month, 240 of 240. And on 11,501 contract-months / 102 contracts
// aggregated from executions 94327-94336, which is where the bug below was caught.
import { apply } from './_lib.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node apply-D2-mv-scorer.mjs <path to scorer.stage2.js>'); process.exit(1); }

const P1_FIND = `function sumReceived(rows) {
  let total = 0;
  let n = 0;
  for (const p of rows) {
    if (statusOf(p) !== COLLECTED) continue;
    const amt = parseMoney(p.amountOfPayment);
    total += isNum(amt) ? amt : 0;
    n++;
  }
  return { total: total, rowCount: n };
}`;

const P1_REPLACE = P1_FIND + `

// The month's BILLED total. One monthly_payment row per contract-month is the observed
// shape - 240 of 240 in execution 94336 - so this is normally a single row's
// amountOfPayment; it sums defensively in case a month ever carries more.
//
// TWO exclusions, and the second one is the whole reason this function exists in this
// form rather than a one-line sum.
//
// DELETED: a deleted instalment is a WITHDRAWN bill, not a bill of zero. A month whose
// only row is DELETED therefore has no ledger expectation and falls through to the plan,
// where gates 4 and 8 judge it exactly as they do today. (Rule 20 - a withdrawn
// instalment is not an unpaid month - is a separate, unbuilt change and is deliberately
// NOT smuggled in here.)
//
// REPLACED dead rows: a bounced instalment and the replacement raised against it are the
// SAME bill, not two. Measured across 11,501 contract-months: 987 months carry more than
// one monthly row, and every dead row inside them is BOUNCED with replaced === true - 85
// of 85, no exceptions. Summing those alongside their replacement doubles the month's
// bill and manufactures a shortfall exactly equal to the bounced instalment. An earlier
// draft of this patch did precisely that and produced 85 false reds on 102 contracts,
// i.e. worse than the 42 it removes.
function scheduledForMonth(rowsInMonth) {
  const live = rowsInMonth.filter(function (p) {
    const s = statusOf(p);
    if (s === 'DELETED') return false;
    if (STATUS_DEAD.indexOf(s) !== -1 && p.replaced === true) return false;
    return true;
  });
  if (!live.length) return { amount: null, rowCount: 0, allDeleted: rowsInMonth.length > 0 };
  let total = 0;
  for (const p of live) {
    const a = parseMoney(p.amountOfPayment);
    if (!isNum(a)) return { amount: null, rowCount: live.length, unreadable: true };
    total += a;
  }
  return { amount: Math.round(total * 100) / 100, rowCount: live.length, allDeleted: false };
}`;

const P2_FIND = `  out.gatesRun.push('9', '11', '12');
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

  const received = sumReceived(rows.inMonth);`;

const P2_REPLACE = `  out.gatesRun.push('9', '11', '12');

  // Rows are read BEFORE the expectation now, because the month's ledger row IS the
  // expectation. Reordered 2026-08-26.
  const rows = monthRows(payments, mk);
  if (rows.unassignable.length) {
    out.caps.push(rows.unassignable.length + ' monthly row(s) carry no dateOfPayment');
    out.needsVerifier = true;
  }

  // --- EXPECTATION: what the client was BILLED for this month --------------------
  // Was: currentPayments[].workerSalary + visaFees - the contract plan as it stands
  // TODAY, applied to a month in the past. When a maid's salary rose in July, every
  // earlier month read short by the difference; 42 of 42 amount-mismatch reds were
  // clients who had been billed an amount and had paid exactly that amount, to the fils.
  //
  // Now: the month's own monthly_payment row. Ruling 2 of 2026-08-25, implemented against
  // the real ledger - note the row carries no salary field, it carries the invoiced
  // total, which is the figure the comparison actually wants. No salary lookup is needed.
  const plan = deriveExpected(contract);
  const sched = scheduledForMonth(rows.inMonth);
  out.scheduledAmount = sched.amount;
  out.scheduledRowCount = sched.rowCount;

  let exp;
  if (isNum(sched.amount)) {
    exp = { expected: sched.amount, source: 'ledger: monthly_payment row for ' + mk };
  } else {
    // Ruling 2's accepted residual, recorded on the row rather than argued away: with no
    // live schedule row the fallback reproduces the original point-in-time bug, and a gap
    // resting on it reds like any other.
    exp = { expected: plan.expected, source: plan.source ? 'fallback ' + plan.source : null };
    if (isNum(plan.expected)) {
      out.caps.push('no live schedule row for ' + mk + ' - expectation fell back to the current plan, which cannot see a past salary');
    }
  }
  out.expected = exp.expected;
  out.expectedSource = exp.source;

  // Rule 9 (Order 180) - the plan's internal cross-check, now a HARD gate but correctly
  // scoped. The plan is no longer the basis, so its failing to reconcile with itself only
  // endangers a verdict when the fallback is carrying the month.
  if (plan.crossCheckOk === false) {
    out.caps.push('split does not reconcile with currentPayment.amountValue');
    out.needsVerifier = true;
    if (!isNum(sched.amount)) {
      return conclude(VERDICT.INCONCLUSIVE, '9',
        'the contract plan does not reconcile with itself and there is no schedule row to fall back on', {
        needsVerifier: true,
      });
    }
  }

  // The plan and the invoice disagreeing IS a real signal - the company raised a salary
  // and went on billing the old figure - but it is a BILLING failure, and pricing was
  // ruled permanently out of scope for this check on 2026-08-17 ("we don't care about the
  // pricing, as long as the client paid what he was supposed to pay, mark it as closed").
  // So it is recorded and handed to a human, and it never opens a case here.
  if (isNum(sched.amount) && isNum(plan.expected) && cmpMoney(plan.expected, sched.amount) !== 0) {
    out.billedVsPlanGap = Math.round((plan.expected - sched.amount) * 100) / 100;
    out.caps.push('the plan derives ' + plan.expected + ' for this month but the client was billed ' +
      sched.amount + ' - a BILLING discrepancy, not a collection one');
    out.needsVerifier = true;
  }

  const received = sumReceived(rows.inMonth);`;

apply(file, [
  { name: 'scheduledForMonth() helper added after sumReceived()', find: P1_FIND, replace: P1_REPLACE },
  { name: 'expectation now reads the month’s own ledger row', find: P2_FIND, replace: P2_REPLACE },
], 'D2');
