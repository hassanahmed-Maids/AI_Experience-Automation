// Attach Payments — MV Overstay Fines (v1). Mode: Run Once for Each Item.
//
// gate 10 — recovery is the sum of RECEIVED overstay-fee payments on the contract.
// This node normalises the rows and, critically, records whether the result was
// COMPLETE. `Compute Case States` refuses to conclude anything from a truncated
// one.
//
// BOTH FILTERS ARE REQUIRED and they live on the HTTP node: contract.id AND
// typeOfPayment.id = 8610. Measured live 2026-08-12 on contract 1101801 — with
// contract.id alone the search returns 40 rows of totalElements 599, every one of
// them `monthly_payment`, and shows zero overstay payments. That reads as "never
// billed" and it is false. This node asserts completeness so that failure mode
// cannot reach a verdict.
//
// DO NOT FOLLOW THE `replaced` FLAG to chain payments. On contract 1100875 a
// DELETED 1,250 is followed by a RECEIVED 250 with replaced = false on BOTH,
// because it is a re-bill after a waiver, not a partial payment. Confirmed live.
// Every overstay-fee row on the contract is summed instead.
//
// `vat` is 0.0 and `vatPaidByClient` false on 20 of 20 rows measured, so there is
// no VAT on this line and raw amounts are compared. Per the Skeleton Contract no
// VAT rate is hardcoded anywhere — the value is read off each row and carried.
const TYPE_ID = 8610;         // typeOfPayment.code = overstay_fee
const fetched = $input.item.json;
const carry = $('Attach Fines').item.json;
const out = Object.assign({}, carry);

// `Get Overstay Payments` runs with onError: continueRegularOutput as of 2026-08-23, so that
// `Judge Payments Batch` can COUNT its failures (ERP-LOAD-POLICY.md §5). A read that FAILED
// arrives here carrying `error` and no `content`, and it is caught first so the review note says
// the search failed rather than that it returned an unexpected shape. The distinction matters
// more here than anywhere else in this flow: an unread payment search reads as "never billed",
// which is the exact false clean this node was written to prevent.
if (fetched && fetched.error !== undefined && fetched.error !== null &&
    !Array.isArray(fetched.content)) {
  const e = fetched.error;
  out.payments = [];
  out.payments_complete = false;
  out.enrich_blocked = out.enrich_blocked || 'payments_unread';
  out.enrich_blocked_text = out.enrich_blocked_text ||
    ('The overstay-fee payment search FAILED: ' + String((e && e.message) || e).slice(0, 300) +
     ' — routed to review. Never read as nothing recovered.');
  return { json: out };
}

const body = (fetched && typeof fetched === 'object') ? fetched : {};
const content = Array.isArray(body.content) ? body.content : null;

if (content === null) {
  out.payments = [];
  out.payments_complete = false;
  out.enrich_blocked = out.enrich_blocked || 'payments_unreadable';
  out.enrich_blocked_text = out.enrich_blocked_text ||
    ('The overstay-fee payment search returned no `content` array. keys=' +
     Object.keys(body).join(',') + ' — routed to review. Never read as nothing recovered.');
  return { json: out };
}

const total = body.totalElements === undefined ? null : Number(body.totalElements);
out.payments_total_elements = total;
out.payments_returned = content.length;
out.payments_complete = (total !== null && content.length === total);

out.payments = content
  // The HTTP filter already scopes to 8610; this is a second, cheap assertion that
  // the filter was actually applied. A row of another type here means the request
  // body was changed and the "both filters" trap is live again.
  .filter(function (p) {
    const tp = p.typeOfPayment || {};
    return Number(tp.id) === TYPE_ID;
  })
  .map(function (p) {
    return {
      payment_id: p.id === undefined ? '' : String(p.id),
      amount: p.amountOfPayment,
      status: (p.status || {}).value || '',
      replaced: p.replaced === true,      // captured, deliberately NOT followed
      vat: p.vat,
      vat_paid_by_client: p.vatPaidByClient === true,
      type_code: (p.typeOfPayment || {}).code || ''
    };
  });

out.payments_foreign_type = content.length - out.payments.length;
if (out.payments_foreign_type > 0) {
  out.payments_complete = false;
  out.enrich_blocked = out.enrich_blocked || 'payments_filter_not_applied';
  out.enrich_blocked_text = out.enrich_blocked_text ||
    (out.payments_foreign_type + ' of ' + content.length + ' rows are not typeOfPayment 8610 — ' +
     'the typeOfPayment filter was not applied. With contract.id alone this search returns ' +
     'unrelated monthly payments and no overstay row at all, which reads as "never billed" and ' +
     'is false. Routed to review.');
}

return { json: out };
