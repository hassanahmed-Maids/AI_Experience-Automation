// D14 — CC Price by Cohort: cross-check the paymentsInfo resolver against ERP's own
// numeric rate, and raise a hand when a bounded promo is the basis.
//
//   node apply-D14-cc-price.mjs <scorer-month.js> <build-score-node.js>
//
// Grounded on 60 live contracts from execution 94326: ten carry a bounded
// "(Monthly (for N months))" line, each followed by a standing line on an exact card
// price, and nextMonthlyPaymentAmount agrees with the standing prose line on 38 of 38
// testable contracts, 0 disagreements. The successive/supersession model is therefore
// CORRECT and is deliberately left alone - an earlier draft of this fix rewrote it, which
// would have deleted the genuine below-card intro rate the 2026-08-19 policy exists to catch.
import { apply } from './_lib.mjs';

const scorerMonth = process.argv[2];
const buildScoreNode = process.argv[3];
if (!scorerMonth || !buildScoreNode) {
  console.error('usage: node apply-D14-cc-price.mjs <scorer-month.js> <build-score-node.js>');
  process.exit(1);
}

apply(scorerMonth, [
  { name: 'consumed-fields comment lists the two new fields', find: "//   contract_id, maid_nationality, live_out, contract_start_date,", replace: "//   contract_id, maid_nationality, live_out, contract_start_date,\n//   next_monthly_payment_amount, next_monthly_payment_date," },
  { name: 'needs_human on a bounded basis + cross-check at nextMonthlyPaymentDate', find: "  if (entry.duration_months !== null) out.flags.push('bounded_rate_period');", replace: "  //\n  // needs_human is set HERE, not merely flagged. Ruled 2026-08-26: the 08-19\n  // policy assumes a human clears an approved promotion, and the flag alone\n  // never summoned one - the case shipped as a red with the reason attached and\n  // nobody asked to look at it.\n  if (entry.duration_months !== null) {\n    out.flags.push('bounded_rate_period');\n    out.needs_human = true;\n  }\n\n  // --- CROSS-CHECK: this resolver against ERP's own numeric figure ---------\n  // Ruled 2026-08-26. paymentsInfo REMAINS the rate basis - it is the only\n  // month-scoped source, and currentPayment.amountValue was removed on\n  // 2026-08-18 for being whatever period happens to be current\n  // (rate-field-is-wrong.md). nextMonthlyPaymentAmount is a different field and\n  // is used only to confirm that this parser and this supersession model agree\n  // with ERP about the SAME month.\n  //\n  // Measured on 60 live contracts (execution 94326): the two agree 38 of 38,\n  // including all ten carrying a bounded line. A disagreement is therefore not\n  // a modelling difference - it means this contract's terms cannot be read\n  // reliably. It is the shape the 145 wrong reds took: a resolved 693 against\n  // an active rate of 4,715.\n  //\n  // Compared AT nextMonthlyPaymentDate, never at the audited month. A contract\n  // legitimately inside a bounded window pays the promo rate in M while\n  // nextMonthlyPaymentAmount already describes the standing rate, so comparing\n  // across that boundary would manufacture a disagreement on every honest\n  // promotion - which is precisely the signal the 08-19 policy protects.\n  const npAmount = num(c.next_monthly_payment_amount);\n  const npMs = parseIso(c.next_monthly_payment_date);\n  if (npAmount !== null && npMs !== null) {\n    const npDate = new Date(npMs);\n    const npMonth = npDate.getUTCFullYear() + '-' + String(npDate.getUTCMonth() + 1).padStart(2, '0');\n    const npBounds = monthBounds(npMonth);\n    const npRates = npBounds ? resolveMonthlyRate(c.payments_info, npBounds.first, startMs) : null;\n    if (npRates && npRates.applicable.length === 1) {\n      const npEntry = npRates.applicable[0];\n      if (Math.abs(npEntry.amount - npAmount) > 0.5) {\n        out.state = 'pending';\n        out.verdict = \"Can't tell\";\n        out.reason_code = 'rate_conflicts_next_payment';\n        out.needs_human = true;\n        out.flags.push('rate_conflicts_next_payment(' + npEntry.amount + '_vs_' + npAmount + '@' + npMonth + ')');\n        return out; // never price a contract whose two rate statements disagree\n      }\n    } else {\n      // Not a failure. The next payment date can fall before every entry's\n      // coverage, or inside an overlap the caller already routes on. Recorded so\n      // \"the cross-check passed\" and \"it could not run\" never read the same.\n      out.flags.push('rate_crosscheck_unavailable');\n    }\n  } else {\n    out.flags.push('rate_crosscheck_no_erp_figure');\n  }" },
], 'D14 scorer-month.js');

apply(buildScoreNode, [
  { name: 'carry nextMonthlyPaymentAmount/Date onto the contract object', find: "      payments_info: Array.isArray(plan.paymentsInfo) ? plan.paymentsInfo : [],\n      additional_discount: str(plan.additionalDiscount),", replace: "      payments_info: Array.isArray(plan.paymentsInfo) ? plan.paymentsInfo : [],\n      // ERP's own numeric statement of the monthly rate. Used ONLY to validate the\n      // paymentsInfo resolver - never as the rate itself. Absent on many ending\n      // contracts (22 of 60 sampled), which the cross-check handles explicitly.\n      next_monthly_payment_amount: d.nextMonthlyPaymentAmount === undefined ? null : d.nextMonthlyPaymentAmount,\n      next_monthly_payment_date: d.nextMonthlyPaymentDate || null,\n      additional_discount: str(plan.additionalDiscount)," },
], 'D14 build-score-node.js (n8n glue section)');
