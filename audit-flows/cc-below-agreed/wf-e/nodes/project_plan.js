// Project Plan (WF-E) - the EXPECTED side: gates 3, 4 and the inputs for gate 5.
//
// LIFTED FROM WF-A's `Attach Plan` AND IT MUST STAY BEHAVIOURALLY IDENTICAL. Only two
// things changed, both mechanical: the pairing source is `Read Chunk` rather than
// `Needs enrichment?`, and every regex is written with character classes instead of
// backslash escapes (see the note on parseDiscount). If the reasoning below and WF-A's
// copy ever disagree, WF-A's is not the survivor - this one runs.
//
// v1 architecture note, carried over verbatim because it is why the shape looks like this:
// `runOnceForAllItems`, paired positionally, emitting a slim delta. This is the shape the
// sibling check had to be rewritten into after it crashed out of memory - per-item
// `$('Node').item` lookups walk the pairing chain, and rebuilding the full case at each
// stage retains a copy per stage.
const cases = $('Read Chunk').all().map(function (i) { return i.json; });
const responses = $input.all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

if (responses.length !== cases.length) {
  throw new Error('Project Plan: ' + responses.length + ' plan responses for ' + cases.length +
    ' candidates. Positional pairing is broken - a contract would be priced from another ' +
    'contract\'s plan. The HTTP node above runs alwaysOutputData with onError ' +
    'continueRegularOutput precisely so the counts cannot drift; if they have drifted, one of ' +
    'those two settings was lost.');
}

// ---------------------------------------------------------------- discounts
// BOTH DISCOUNT FIELDS ARE PROSE WITH A DURATION INSIDE THE VALUE, and both come back as
// "" when absent - so `x != null` is TRUE, defaults never fire, and `Number("")` is 0 and
// finite. "Credit Note Amount: 0 applied on Service Fee" is a NON-EMPTY string describing
// a ZERO discount, so testing the raw field for truthiness reads no discount as a real one.
//
// "Discount Amount: 1000 applied on Service Fee over 4 months" is 250 A MONTH, not 1000 off
// this month. Subtracting 1000 over-credits by 750 and turns a real shortfall green.
//
// THE REGEXES USE CHARACTER CLASSES, NOT BACKSLASH ESCAPES - [.] for a literal dot,
// [ ] for a space - because this body is shipped into an n8n Code node as a string and a
// backslash class is exactly what gets eaten in transit. [.] is exactly equivalent to
// the original backslash-dot. [ ]+ is NARROWER than the original backslash-s-plus: it will
// not match across a newline or a tab. The text is single-line ERP prose, and the newlines
// are flattened to spaces below before matching, so the two agree on every input this sees.
// offline/enrich_test.js runs both forms over the same strings and asserts they agree.
function parseDiscount(raw) {
  const text = s(raw);
  if (!text.trim()) return { present: false, text: '', amount: 0, months: null, per_month: 0 };
  // Flatten newlines/tabs with String.fromCharCode rather than an escape, for the reason
  // above, so over-N-month behaves like the original whitespace-class version.
  const flat = text.split(String.fromCharCode(10)).join(' ')
                   .split(String.fromCharCode(13)).join(' ')
                   .split(String.fromCharCode(9)).join(' ');
  const m = /(-?[0-9][0-9,]*(?:[.][0-9]+)?)/.exec(flat);
  const value = m ? Number(String(m[1]).replace(/,/g, '')) : 0;
  const dm = /over[ ]+([0-9]+)[ ]+month/i.exec(flat);
  const months = dm ? Number(dm[1]) : null;
  const finite = Number.isFinite(value);
  return {
    present: finite && value > 0,
    text: text,
    amount: finite ? value : 0,
    months: months,
    per_month: (finite && months && months > 0) ? r2(value / months) : (finite ? value : 0)
  };
}

let unreadable = 0, withDiscount = 0, oneMonth = 0, firstMonthStub = 0, fetchFailures = 0;
const out = cases.map(function (c, i) {
  const resp = responses[i] || {};
  const plan = resp.paymentPlan || {};
  const fetchFailed = !resp.paymentPlan && !resp.currentPayment && !!(resp.error || resp.status || resp.path);
  if (fetchFailed) fetchFailures++;

  // ---- GATE 3: the expected amount is the contract's OWN rate ------------
  // currentPayment.amountValue, VAT-INCLUSIVE, exactly as returned.
  // NEVER the price card - that is the third sibling check, with its own five cohorts and
  // 49 dated windows, and none of its constants belong here.
  // NEVER multiply by 1.05: agreed x 1.05 matches 0 of 5,612 contracts, so adding VAT
  // would flag the entire population.
  // NOT paymentPlan.monthlyAmount (does not exist) and NOT nextMonthlyPaymentAmount (holds
  // the NEXT SCHEDULED payment and is blank when none is scheduled - blank even on ACTIVE
  // contracts).
  const raw = resp.currentPayment ? resp.currentPayment.amountValue : undefined;
  const amount = Number(raw);
  const known = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(amount);
  if (!known) unreadable++;

  const additional = parseDiscount(plan.additionalDiscount);
  const creditNote = parseDiscount(plan.creditNoteDiscount);
  if (additional.present || creditNote.present) withDiscount++;

  // ---- GATE 4: discounts -------------------------------------------------
  // DELIBERATE DEPARTURE FROM THE RULE AS WRITTEN, AND IT IS FLAGGED ON THE CASE.
  // Gate 4 (Order 40) says:
  //     expected = expected_gross - (additionalDiscount / its months) - PAYMENT_ITEM_DISCOUNT
  // Implemented literally that DOUBLE-CREDITS, and the spec's own test case proves it.
  // Contract 1097602, July 2026, verified live: currentPayment.amountValue = 4,452 WITH
  // additionalDiscount "Discount Amount: 1000 applied on Service Fees over 4 months"
  // (= 250/month), and the client paid 2,252 + 2,200 = exactly 4,452. If the 250 were still
  // to be subtracted the expectation would be 4,202 and that correct payment would read as a
  // 250 OVERPAYMENT. The ERP Variables row says the same in words: "additionalDiscount is
  // already reflected inside the contract's own payment plan; never subtract it a second
  // time."
  //
  // So: the discount is NOT subtracted here. It is carried as evidence, and
  // gate4_departure is set so the reviewer can see the rule and the code disagree and
  // rule on it. PAYMENT_ITEM_DISCOUNT lives in Snowflake, which this n8n instance cannot
  // reach at all, so it is recorded as unavailable rather than silently treated as zero.
  const expectedGross = known ? r2(amount) : null;

  // paymentsInfo IS FREE TEXT and must be parsed, not read as fields. The label alternates
  // between 'Service Fee' and 'Service Fees'. A '(One Time Payment)' line is the
  // first-month stub, NOT the recurring rate - reading element 0 and assuming it is the
  // monthly is wrong.
  const paymentsInfo = Array.isArray(plan.paymentsInfo) ? plan.paymentsInfo.map(s) : [];
  const monthlyLine = paymentsInfo.filter(function (l) { return /[(]Monthly[)]/i.test(l); })[0] || '';
  const oneTimeLine = paymentsInfo.filter(function (l) { return /[(]One[ ]*Time/i.test(l); })[0] || '';
  if (oneTimeLine) firstMonthStub++;

  // ---- GATE 5 inputs: the pro-rating skip branches -----------------------
  // ERP's own formula (CalculateDiscountsWithVatService.getProRatedAmount) has three
  // branches that skip the day-count entirely, so the flow must look for them rather than
  // always dividing:
  //   1. firstMonthPayment set (and not a one-month agreement) -> use it outright
  //   2. a stored dailyRateAmount > 0 (not one-month) -> use that daily rate
  //   3. isOneMonthAgreement (ACC-5712) -> force the division branch
  const firstMonthPayment = num(resp.firstMonthPayment !== undefined ? resp.firstMonthPayment
                                                                    : plan.firstMonthPayment);
  const dailyRateAmount = num(resp.dailyRateAmount !== undefined ? resp.dailyRateAmount
                                                                : plan.dailyRateAmount);
  const isOneMonthAgreement = (resp.isOneMonthAgreement === true) || (plan.isOneMonthAgreement === true);
  if (isOneMonthAgreement) oneMonth++;

  return { json: {
    // The ids travel on so the replacement fetch below has a contract to ask about and the
    // caller has a key to join on.
    case_key: s(c.case_key),
    contract_id: s(c.contract_id),
    client_id: s(c.client_id),
    plan: {
      fetch_failed: fetchFailed,
      expected_gross: expectedGross,
      expected_amount_known: known,
      expected_basis: 'currentPayment.amountValue, VAT-inclusive, the contract\'s own agreed rate',
      // The single most important caveat on this check. This field is the CONTRACTUAL rate
      // and is NOT reliably what was billed: on 1054346, 1086789 and 1090543 it read
      // 4,715 / 4,715 / 5,712 while the client was billed and paid 2,100 / 2,100 / 3,360 for
      // three to four consecutive months, and BOTH numbers were sent to the same client in
      // writing by two template families. A gap against it is a CANDIDATE. Gate 13 is what
      // turns one into a finding.
      rate_is_contractual_not_billed: true,
      payments_info: paymentsInfo,
      monthly_info_line: monthlyLine,
      one_time_line: oneTimeLine,
      additional_discount: additional,
      credit_note_discount: creditNote,
      gate4_departure: (additional.present || creditNote.present) ? {
        rule_says: 'subtract additionalDiscount / its stated months from the expected amount',
        code_does: 'does NOT subtract - currentPayment.amountValue already reflects it',
        evidence: 'contract 1097602: rate 4,452 WITH a 1000-over-4-months discount, and 4,452 ' +
                  'was exactly what the client paid. Subtracting 250 would report a 250 overpayment.',
        needs_ruling: true
      } : null,
      snowflake_item_discount: 'UNAVAILABLE - CONTRACT_PAYMENT_PLAN_ITEMS.PAYMENT_ITEM_DISCOUNT is a ' +
        'Snowflake field and this n8n instance has no Snowflake credential. Recorded as unavailable, ' +
        'never as zero: on 1097602 the item discount was 0 while the term discount was 1000, so they ' +
        'are different facts and assuming either is a guess.',
      first_month_payment: firstMonthPayment,
      daily_rate_amount: dailyRateAmount,
      is_one_month_agreement: isOneMonthAgreement
    }
  } };
});

console.log(JSON.stringify({ stage: 'wfe_project_plan', candidates: out.length,
  plan_fetch_failures: fetchFailures, unreadable_expected_amount: unreadable,
  with_a_discount: withDiscount, one_month_agreements: oneMonth,
  with_first_month_stub: firstMonthStub }));

return out;
