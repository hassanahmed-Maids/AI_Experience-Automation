// Resolve Quoted Amounts - GATE 14 (Order 140), and the input gate 13 cannot do
// without. It answers one question per candidate: what amount did WE quote to this
// client for this month, and which family quoted it?
//
// WHY A BAKED LOOKUP. ERP's smsLog returns the template NAME plus the parameter
// VALUES - e.g. "{1}: 2,100, {2}: the monthly visa fee and salary" - and nothing
// that says what {1} MEANS. `smsContent` is EMPTY on every WhatsApp row (131
// checked), so the body has to come from somewhere else. The template store is the
// somewhere else, and the bodies below were pulled from it on 2026-08-14 via
// GET /clientmgmt/clientbroadcast/templates + gettemplateinfo. Snowflake also holds
// them, but this n8n instance has no Snowflake credential, so a live read is not an
// option and a baked snapshot is.
//
// RULE 14 SAYS RESOLVE BY NAME, NEVER BY POSITION - and the store makes that
// possible, because ERP does NOT store positional {1}/{2} at all. It stores NAMED
// @param@ tokens; the {n} numbering is Meta's, recovered from the order each token
// first appears in the body. That order is what `order` below records, so the index
// is DERIVED from the name rather than assumed.
//
// MEASURED, AND IT CORRECTS THE SPEC: the amount index is CONSTANT across every
// step of a family - monthly_reminder is {3} at steps 1_1..4_1, and every
// online_reminder variant is {1} at steps 1_1..1_10. It differs only BETWEEN
// families. The spec assumed the index moves between steps; against the live bodies
// it does not. A per-family constant is safe; a single global index would be wrong.
//
// THE TWO FAMILIES ARE THE WHOLE POINT (rule 15):
//   quotes_contract_rate     - acc_cc_client_paying_via_cc_monthly_reminder_*
//                              quotes THIS contract's stored rate. On 1054346 it
//                              said AED 4,715.
//   quotes_requested_amount  - acc_cc_client_online_reminder_*
//                              quotes what accounting actually ASKED FOR. On the
//                              same contract, days later, it said AED 2,100.
// If the client paid what the online_reminder asked and that was below the contract
// rate, we UNDER-BILLED - which the owner ruled on 2026-08-13 IS a finding. If
// accounting asked the contract rate and less arrived, the client UNDERPAID. Same
// money, different teams, and only these templates can tell them apart.
//
// STALENESS IS THE COST OF BAKING, so it is made loud rather than left silent: the
// pull date is stamped, and every message whose template is NOT in the lookup is
// counted and reported. An unknown template makes a case INCONCLUSIVE - it never
// makes it a finding, and it never clears one.
const PULLED_ON = '2026-08-14';
const TEMPLATES = {
 "CC_ACCOUNTING_NOT_OWED_MONEY_FROM_CLIENT_8_1_2_NOTIFICATION": { "amount_index": 1, "amount_param": "amount", "family": "no_amount", "order": ["amount"], "template_id": 4454 },
 "CC_ACCOUNTING_OWE_MONEY_TO_CLIENT_8_1_1_NOTIFICATION": { "amount_index": 1, "amount_param": "remaining_balance", "family": "no_amount", "order": ["remaining_balance"], "template_id": 4456 },
 "acc_cc_client_online_reminder_not_required_multiple_payments_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46086 },
 "acc_cc_client_online_reminder_not_required_multiple_payments_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46088 },
 "acc_cc_client_online_reminder_not_required_one_payment_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 4630 },
 "acc_cc_client_online_reminder_not_required_one_payment_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 4632 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46046 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_10": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_tomorrow"], "template_id": 46054 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 46048 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_3": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5143 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_4": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 4739 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_5": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5147 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_6": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5184 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_7": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","breakdown_description","paytabs_link"], "template_id": 5677 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_8": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_after_3_days"], "template_id": 46050 },
 "acc_cc_client_online_reminder_required_multiple_payments_1_9": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","maid_first_name","paytabs_link","breakdown_description","paid_end_date_or_after_2_days"], "template_id": 46052 },
 "acc_cc_client_online_reminder_required_one_payment_1_1": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 46066 },
 "acc_cc_client_online_reminder_required_one_payment_1_10": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_tomorrow"], "template_id": 46074 },
 "acc_cc_client_online_reminder_required_one_payment_1_2": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 46068 },
 "acc_cc_client_online_reminder_required_one_payment_1_3": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5679 },
 "acc_cc_client_online_reminder_required_one_payment_1_4": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5681 },
 "acc_cc_client_online_reminder_required_one_payment_1_5": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5683 },
 "acc_cc_client_online_reminder_required_one_payment_1_6": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5685 },
 "acc_cc_client_online_reminder_required_one_payment_1_7": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link"], "template_id": 5701 },
 "acc_cc_client_online_reminder_required_one_payment_1_8": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_after_3_days"], "template_id": 46070 },
 "acc_cc_client_online_reminder_required_one_payment_1_9": { "amount_index": 1, "amount_param": "amount", "family": "quotes_requested_amount", "order": ["amount","description","maid_first_name","paytabs_link","paid_end_date_or_after_2_days"], "template_id": 46072 },
 "acc_cc_client_paying_via_cc_monthly_reminder_1_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5149 },
 "acc_cc_client_paying_via_cc_monthly_reminder_2_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5151 },
 "acc_cc_client_paying_via_cc_monthly_reminder_3_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 5153 },
 "acc_cc_client_paying_via_cc_monthly_reminder_4_1": { "amount_index": 3, "amount_param": "amount", "family": "quotes_contract_rate", "order": ["maid_name","paid_end_date","amount","paying_via_credit_card_sms"], "template_id": 23569 },
 "notifiers_du_pay_clients": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["Mr./Ms.","client_first_name","maid_first_name","he/she","his/her","maid_name","download_link","tutorial_link_registration","him/her","tutorial_link_ATM","next_month","maid_country"], "template_id": 53505 },
 "notifiers_du_pay_clients_cc": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["Mr./Ms.","client_first_name","maid_first_name","he/she","his/her","maid_name","download_link","tutorial_link_registration","him/her","tutorial_link_ATM","next_month","maid_country"], "template_id": 54926 },
 "notifiers_settle_payment_reminder": { "amount_index": null, "amount_param": null, "family": "no_amount", "order": ["paying_via_credit_card_link"], "template_id": 50024 }
};

const cases = $('Select Candidates').all().map(function (i) { return i.json; });
const waResp = $('Get Messages (WhatsApp)').all().map(function (i) { return i.json; });
const smsResp = $('Get Messages (SMS)').all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

if (waResp.length !== cases.length || smsResp.length !== cases.length) {
  throw new Error('Resolve Quoted Amounts: ' + waResp.length + ' WhatsApp and ' + smsResp.length +
    ' SMS responses for ' + cases.length + ' candidates. Positional pairing is broken, so a quoted ' +
    'amount would be attributed to the wrong contract - refusing to guess.');
}

// AMOUNTS ARRIVE BOTH BARE (4715) AND COMMA-GROUPED (2,100), so normalise before
// comparing anything.
function toAmount(raw) {
  const t = s(raw).replace(/AED/ig, '').replace(/,/g, '').trim();
  const m = /(-?[0-9]+(?:\.[0-9]+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// templateContent comes back as the parameter VALUES, keyed by position:
//   "{1}: 2,100, {2}: the monthly visa fee and salary"
// Parse it into an index -> value map. Anything unparseable stays unparsed rather
// than being coerced into a number.
function parseParams(content) {
  const out = {};
  const text = s(content);
  const re = /\{(\d+)\}\s*:\s*([^{]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[Number(m[1])] = s(m[2]).replace(/[,\s]+$/, '').trim();
  }
  return out;
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.content)) return body.content;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}
function fetchFailed(body) {
  if (!body) return true;
  if (body.error) return true;
  return !(Array.isArray(body) || (body && (Array.isArray(body.content) || Array.isArray(body.data))));
}

let unknownTemplates = {}, totalQuotes = 0, failedReads = 0;
const out = cases.map(function (c, i) {
  const failed = fetchFailed(waResp[i]) || fetchFailed(smsResp[i]);
  if (failed) failedReads++;

  const rows = rowsOf(waResp[i]).map(function (r) { return { ch: 'WHATSAPP', r: r }; })
    .concat(rowsOf(smsResp[i]).map(function (r) { return { ch: 'SMS', r: r }; }));

  const quotes = [];
  for (const item of rows) {
    const r = item.r;
    const name = s(r.templateName);
    // sentDate is the ONLY usable date on this endpoint - creationDate and
    // dateOfMessage are null on every row, and using either makes the whole
    // population read as "nobody was ever told anything".
    const sent = s(r.sentDate).slice(0, 10);
    if (!name) continue;

    const tpl = TEMPLATES[name];
    if (!tpl) { unknownTemplates[name] = (unknownTemplates[name] || 0) + 1; continue; }
    if (tpl.amount_index === null) continue;      // template carries no amount at all

    const params = parseParams(r.templateContent);
    const raw = params[tpl.amount_index];
    const amount = toAmount(raw);
    if (amount === null) {
      unknownTemplates['UNPARSED:' + name] = (unknownTemplates['UNPARSED:' + name] || 0) + 1;
      continue;
    }
    totalQuotes++;
    quotes.push({
      template: name,
      family: tpl.family,
      channel: item.ch,
      sent_date: sent,
      amount: amount,
      // The label matters: on 1097602 "{2}: the monthly visa fee and salary" sat
      // beside a SECOND payment link for a different figure, and reading only the
      // first understates the month by 2,200.
      label: s(params[tpl.amount_index + 1] || ''),
      resolved_by: 'param name "' + s(tpl.amount_param) + '" at position ' + tpl.amount_index +
        ' (derived from the stored body order, not assumed)'
    });
  }

  quotes.sort(function (a, b) { return String(b.sent_date).localeCompare(String(a.sent_date)); });
  const contractRateQuotes = quotes.filter(function (q) { return q.family === 'quotes_contract_rate'; });
  const requestedQuotes = quotes.filter(function (q) { return q.family === 'quotes_requested_amount'; });

  return { json: Object.assign({}, c, {
    quoted: {
      lookup_pulled_on: PULLED_ON,
      templates_known: 33,
      read_failed: failed,
      quotes: quotes,
      // What we told them the contract rate was, and what we actually asked for.
      contract_rate_quoted: contractRateQuotes.length ? contractRateQuotes[0].amount : null,
      requested_quoted: requestedQuotes.length ? requestedQuotes[0].amount : null,
      families_seen: Object.keys(quotes.reduce(function (a, q) { a[q.family] = 1; return a; }, {})),
      // Gate 14's honest limit: no quote at all is NOT evidence that nothing was
      // quoted. It can equally mean the message predates the log window, went by a
      // channel this endpoint does not carry, or used a template the bake does not
      // know. Either way the case is inconclusive, never a finding.
      no_quote_found: quotes.length === 0
    }
  }) };
});

console.log(JSON.stringify({ stage: 'resolve_quoted_amounts', candidates: out.length,
  quotes_resolved: totalQuotes, message_read_failures: failedReads,
  lookup_pulled_on: PULLED_ON, templates_in_lookup: 33,
  unknown_or_unparsed_templates: unknownTemplates,
  note: 'An unknown template makes a case inconclusive. If this map is non-empty the bake needs a ' +
        'refresh from /clientmgmt/clientbroadcast/templates - it is a snapshot, not a live read.' }));

return out;

